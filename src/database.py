# small img (64x64?), artist, track, title, artist id, track id, disc id, 

# Release - Disk - Track
# Track - Artist
# Release - Artist

import mutagen
import mutagen.flac
import mutagen.mp3
import mutagen.mp4
import mutagen.oggvorbis
import mutagen.apev2
import mutagen.asf
import couchdb
import copy
import os
import errno
import hashlib
import StringIO
import PIL
import PIL.Image
import PIL.JpegImagePlugin
import PIL.BmpImagePlugin
import PIL.PngImagePlugin
import PIL.GifImagePlugin
import struct
import glob
import os
import re

COVER_ART_SIZES = (512, 256, 128, 64)

MIME_MAP = {
	PIL.JpegImagePlugin.JpegImageFile: ("image/jpeg", ".jpeg"),
	PIL.BmpImagePlugin.BmpImageFile: ("image/bmp", ".bmp"),
	PIL.PngImagePlugin.PngImageFile: ("image/png", ".png"),
	PIL.GifImagePlugin.GifImageFile: ("image/gif", ".gif"),
}

CTYPE_MAP = {
	".js": "text/javascript; charset=UTF-8",
	".html": "text/html; charset=UTF-8",
	".css": "text/css; charset=UTF-8",
}

CRE_REPLACE = re.compile("^.*%%%([A-Z_]+)%%%$")

def _id(d):
	# base64 uses + and /, which are not very safe to include in URL path
	# base64url uses - and _ instead
	# since we cannot use _ at the beginning of document id, we use . instead
	return d.encode("base64")[:(len(d)*8+5) // 6].replace("+", "-").replace("/", ".")

def sha1_id(data):
	return _id(hashlib.sha1(data).digest())

class Database(object):
	def __init__(self, url, prefix):
		self.scanner = {
			mutagen.flac.FLAC: self.updateFLAC,
			mutagen.mp3.MP3: self.updateMP3,
			mutagen.oggvorbis.OggVorbis: self.updateOggVorbis,
			mutagen.mp4.MP4: self.updateMP4,
			mutagen.asf.ASF: self.updateASF,
		}
		self.db = couchdb.Server(url)
		self.files = self._create(prefix + "file")
		self.pictures = self._create(prefix + "picture")
		self.app = self._create(prefix + "app")

		self._replace = {
			"DB_URL": url,
			"DB_PREFIX": prefix,
		}

	def _update_views(self):
		d = self.files.get("_design/db", {})
		views = d.setdefault("views", {})
		for f in glob.glob("view/file/*.map.js"):
			name = os.path.split(f)[1][:-7]
			views[name] = {"map": open(f, "rb").read().decode("UTF-8")}
		self.files["_design/db"] = d

	def _do_replace(self, f):
		result = StringIO.StringIO()
		for line in f:
			m = CRE_REPLACE.match(line)
			n = m.group(1) if m else None
			if n in self._replace:
				line = "var %s = %s;\n" % (n, couchdb.json.encode(self._replace[n]).encode("UTF-8"))
			result.write(line)
		return result.getvalue()


	def _update_app(self):
		a = self.app.get("1", {})
		self.app["1"] = a

		for f in glob.glob("app/*"):
			name = os.path.split(f)[1]
			self.app.put_attachment(a, self._do_replace(open(f)), name, CTYPE_MAP[os.path.splitext(name)[1]])

	def update_data(self, path):
		p = os.getcwd()
		try:
			os.chdir(os.path.join(p, path))

			self._update_views()
			self._update_app()
		finally:
			os.chdir(p)

	def cleanup(self, cookie):
		map_fun = "function(doc) {if ( doc.cookie !== %s) { emit(doc._id, null); } }" % (couchdb.json.encode(cookie),)
		for row in self.files.query(map_fun):
			del self.files[row.id]

	def search(self, term):
		def view(term, prefix="_design/db/_view/"):
			if term.startswith("artist:"):
				return prefix + "artist", term[7:]
			if term.startswith("album:"):
				return prefix + "album", term[6:]
			if term.startswith("title:"):
				return prefix + "title", term[6:]
			if term.startswith("*:"):
				return prefix + "search", term[2:]
			if term.startswith("all:"):
				return prefix + "search", term[4:]
			return prefix + "search", term

		if term:
			terms = sorted([t.lower() for t in term.split()], key=lambda t: len(t))
		else:
			terms = [""]

		views = [self.files.view(v)[t2:t2 + u"ZZZZZ"] for (v, t2) in (view(t) for t in terms)]
		#print list(views[0])[0]
		keys = set(row.id for row in views[0])
		for view in views[1:]:
			keys &= set(row.id for row in view)

		return sorted(keys)

	def _create(self, name):
		try:
			return self.db[name]
		except couchdb.ResourceNotFound:
			pass
		try:
			return self.db.create(name)
		except couchdb.PreconditionFailed:
			pass
		return self.db[name]

	@staticmethod
	def _autoscale(img, max_width, max_height):
		w, h = img.size
		ww = w * max_height
		hh = h * max_width
		if ww < hh:
			nw = (ww * 2 + h) / (2 * h)
			nh = max_height
		elif hh < ww:
			nw = max_width
			nh = (hh * 2 + w) / (2 * w)
		else:
			nw = max_width
			nh = max_height
		return img.resize((nw, nh), PIL.Image.ANTIALIAS)

	def updatePicture(self, data, version=1):
		k = sha1_id(data)
		pic = self.pictures.get(k)
		if pic is not None and "inprogress" not in pic and pic.get("version", 0) >= version and len(pic.get("_attachments", {})) > 0:
			return k, pic["formats"]
		if pic is not None:
			del self.pictures[k]

		print "processing image", k
		try:
			img = PIL.Image.open(StringIO.StringIO(data))
			mime, ext = MIME_MAP[img.__class__]
			attach = []
			formats = {}
			formats["base"] = {"w": img.size[0], "h": img.size[1], "m": mime, "f": "base" + ext}
			attach.append(("base" + ext, data, mime))

			if img.mode == "P":
				img = img.convert("RGB")

			doc = {"formats": formats, "inprogress": True, "version": version}
			self.pictures[k] = doc

			for s in COVER_ART_SIZES:
				key, mw, mh = str(s), s, s
				if img.size[0] < mw and img.size[1] < mh:
					continue
				i2 = self._autoscale(img, mw, mh)
				formats[key] = {"w": i2.size[0], "h": i2.size[1], "m": "image/jpeg", "f": key + ".jpeg"}
				sio = StringIO.StringIO()
				i2.save(sio, "JPEG")
				del i2
				attach.append((key + ".jpeg", sio.getvalue(), "image/jpeg"))
				del sio
		except IOError:
			return None, None

		for name, data, mime in attach:
			self.pictures.put_attachment(doc, data, name, mime)

		print doc
		doc = self.pictures[k]
		print doc
		doc.pop("inprogress")
		self.pictures[k] = doc

		print formats
		print "done processing image"

		return k, formats

	def _doFLAC(self, dst, src):
		d

	def generic(dstkey):
		def f(dst, value):
			dst[dstkey] = [item.rstrip("\x00") for item in value]
		f.__name__ = 'set_generic_' + dstkey
		return f

	def m4a_numpair(dst1, dst2):
		def f(dst, value):
			dst[dst1], dst[dst2] = value[0]
		f.__name__ = 'set_m4a_numpair_%s_and_%s' % (dst1, dst2)
		return f

	def single_int(dstkey):
		def f(dst, value):
			dst[dstkey] = int(value[0].rstrip("\x00"))
		f.__name__ = 'set_single_int_' + dstkey
		return f

	def int_pair(dst1, dst2):
		def f(dst, value):
			a, slash, b = value[0].rstrip("\x00").partition("/")
			try:
				dst[dst1] = int(a)
			except ValueError:
				print "invalid", dst1, "value:", value
			if slash:
				try:
					dst[dst2] = int(b)
				except ValueError:
					print "invalid", dst2, "value:", value
		f.__name__ = 'set_int_pair_%s_and_%s' % (dst1, dst2)
		return f

	def single_value(dstkey):
		def f(dst, value):
			dst[dstkey] = value[0].rstrip("\x00")
		f.__name__ = 'set_single_value_' + dstkey
		return f

	def id3v2_numpair(dst1, dst2):
		def f(dst, value):
			a, slash, b = value.text[0].partition("/")
			try:
				dst[dst1] = int(a)
			except ValueError:
				print "invalid", dst1, "value:", value
			if slash:
				try:
					dst[dst2] = int(b)
				except ValueError:
					print "invalid", dst2, "value:", value
		f.__name__ = 'set_id3v2_numpair_%s_and_%s' % (dst1, dst2)
		return f

	def id3v2_values(dstkey):
		def f(dst, value):
			#print dstkey, type(value), repr(value)
			dst[dstkey] = value.text
		f.__name__ = 'set_id3v2_values_' + dstkey
		return f

	def id3v2_single_value(dstkey):
		def f(dst, value):
			dst[dstkey] = value.text[0]
		f.__name__ = 'set_id3v2_single_value_' + dstkey
		return f

	def id3v2_single_value_text(dstkey):
		def f(dst, value):
			dst[dstkey] = value.text[0].text
		f.__name__ = 'set_id3v2_single_value_text_' + dstkey
		return f

	def id3v2_data_tolist(dstkey):
		def f(dst, value):
			dst[dstkey] = [value.data]
		f.__name__ = 'set_id3v2_data_tolist_' + dstkey
		return f

	def ape_text(dstkey):
		def f(dst, value):
			assert value.kind == 0
			dst[dstkey] = value.value.decode("UTF-8")
		f.__name__ = 'set_ape_text_' + dstkey
		return f

	def asf_single_value(dstkey):
		def f(dst, value):
			dst[dstkey] = value[0].value
		f.__name__ = 'set_asf_single_value_' + dstkey
		return f

	def asf_values(dstkey):
		def f(dst, value):
			dst[dstkey] = [item.value for item in value]
		f.__name__ = 'set_asf_value_' + dstkey
		return f

	MP4_MAP = {
		'\xa9alb': generic('album'),
		'\xa9nam': generic('title'),
		'\xa9ART': generic('artist'),
		'trkn': m4a_numpair('tracknumber', 'totaltracks'),
		'\xa9day': single_value('date'),
		'\xa9gen': generic('genre'),
		'disk': m4a_numpair('discnumber', 'totaldiscs'),
		# covr
	}

	# {'\xa9alb': [u'Sehnsucht nach Ver\xe4nderung'], 'tmpo': [0], '\xa9nam': [u'Musette'], '\xa9ART': [u"L'art De Passage"], 'trkn': [(1, 11)], '\xa9too': [u'iTunes v7.4.3.1, QuickTime 7.2'], 'cpil': False, '----:com.apple.iTunes:iTunSMPB': [' 00000000 00000840 00000048 00000000002A4B78 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000'], '----:com.apple.iTunes:iTunes_CDDB_IDs': ['11+78B21AEA2DF89AFC94288091A11803DE+1262221'], '\xa9day': [u'1995'], 'pgap': False, '\xa9gen': [u'Jazz'], 'disk': [(1, 1)], '----:com.apple.iTunes:iTunNORM': [' 000000FC 00000130 00002D95 00001B27 0000B7A4 0000B7A4 00005240 000062C4 0000F010 0000F010']}


	FLAC_MAP = {
		'album': generic('album'),
		'artist': generic('artist'),
		'title': generic('title'),
		'replaygain_track_peak': single_value('replaygain_track_peak'),
		'replaygain_track_gain': single_value('replaygain_track_gain'),
		'replaygain_album_peak': single_value('replaygain_album_peak'),
		'replaygain_album_gain': single_value('replaygain_album_gain'),
		'replaygain_reference_loudness': single_value('replaygain_reference_loudness'),
		'tracknumber': int_pair('tracknumber', 'totaltracks'),
		'totaltracks': single_int('totaltracks'),
		'tracktotal': single_int('totaltracks'),
		'musicbrainz_albumartistid': generic('musicbrainz_albumartistid'),
		'musicbrainz_artistid': generic('musicbrainz_artistid'),
		'musicbrainz_trackid': generic('musicbrainz_trackid'),
		'musicbrainz_discid': generic('musicbrainz_discid'),
		'musicbrainz_albumid': generic('musicbrainz_albumid'),
		'date': single_value('date'),
		'albumartistsort': generic('albumartistsort'),
		'artistsort': generic('artistsort'),
		'albumartist': generic('albumartist'),
		'genre': generic('genre'),
		'discnumber': int_pair('discnumber', 'totaldiscs'),
		'totaldiscs': single_int('totaldiscs'),
		'disctotal': single_int('totaldiscs'),
		'media': single_value('media'),
		'composer': generic('composer'),
	}

	OGG_MAP = FLAC_MAP

	# {'album': [u'Crazy Heart Original Motion Picture Soundtrack\x00'], 'artist': [u'Ryan Bingham\x00'], 'tool version': [u'14.0.147\x00'], 'title': [u"I Don't Know\x00"], 'bpm': [u'73\x00'], 'replaygain_track_peak': [u'0.967800\x00'], 'genre': [u'Country\x00'], 'intensity': [u'4\x00'], 'replaygain_track_gain': [u'-7.72 dB\x00'], 'tool name': [u'Media Center\x00'], 'date': [u'2010\x00'], 'tracknumber': [u'6\x00']}
	# {'album': [u'Star Trek The Motion Picture OST CD1'], 'replaygain_reference_loudness': [u'89.0 dB'], 'replaygain_album_gain': [u'-1.05 dB'], 'title': [u'Main Title'], 'artist': [u'Jerry Goldsmith'], 'tracktotal': [u'18'], 'date': [u'1998'], 'replaygain_track_gain': [u'-4.22 dB'], 'genre': [u'Soundtrack'], 'tracknumber': [u'02'], 'discnumber': [u'1'], 'replaygain_track_peak': [u'0.99996948'], 'replaygain_album_peak': [u'1.00000000']}
	# {'replaygain_reference_loudness': [u'89.0 dB'], 'albumartistsort': [u'BerlinskiBeat'], 'disctotal': [u'1'], 'releasecountry': [u'DE'], 'totaldiscs': [u'1'], 'albumartist': [u'BerlinskiBeat'], 'musicbrainz_albumartistid': [u'a014e2d1-7601-4883-b29a-dbfe28423e72'], 'tracknumber': [u'9'], 'replaygain_track_peak': [u'0.98348999'], 'album': [u'Gassenhauer'], 'replaygain_album_gain': [u'-9.54 dB'], 'musicbrainz_artistid': [u'a014e2d1-7601-4883-b29a-dbfe28423e72'], 'title': [u'Champagner f\xfcr alle'], 'media': [u'CD'], 'tracktotal': [u'11'], 'artistsort': [u'BerlinskiBeat'], 'musicbrainz_albumid': [u'd0b44012-44fd-46e1-a561-588ea12a434e'], 'replaygain_album_peak': [u'0.98348999'], 'barcode': [u'4029759081449'], 'releasestatus': [u'official'], 'musicbrainz_discid': [u'SWHZT74tt5V1YmaNlplItv3BY_0-'], 'date': [u'2012-08-03'], 'discnumber': [u'1'], 'originaldate': [u'2012-08-03'], 'language': [u'deu'], 'artist': [u'BerlinskiBeat'], 'script': [u'Latn'], 'releasetype': [u'album'], 'musicbrainz_trackid': [u'7dca8e03-6286-4bd1-8d3b-905aec67c3d6'], 'totaltracks': [u'11'], 'replaygain_track_gain': [u'-9.56 dB']}

	ID3V2_MAP = {
		"TMED": id3v2_single_value('media'),
		"TXXX:MusicBrainz Album Artist Id": id3v2_values('musicbrainz_albumartistid'),
		"TXXX:MusicBrainz Artist Id": id3v2_values('musicbrainz_artistid'),
		"TXXX:MusicBrainz Album Id": id3v2_values('musicbrainz_albumid'),
		"UFID:http://musicbrainz.org": id3v2_data_tolist('musicbrainz_trackid'),
		"TDOR": id3v2_single_value_text('date'),
		"TPE1": id3v2_values('artist'),
		"TSOP": id3v2_values('artistsort'),
		"TALB": id3v2_values('album'),
		"TSOA": id3v2_values('albumsort'),
		"TIT2": id3v2_values('title'),
		"TRCK": id3v2_numpair('tracknumber', 'totaltracks'),
		"TPOS": id3v2_numpair('discnumber', 'totaldiscs'),
		"TCON": id3v2_values('genre'),
		"TCOM": id3v2_values('composer'),
		'TXXX:replaygain_album_peak': id3v2_single_value('replaygain_album_peak'),
		'TXXX:replaygain_track_peak': id3v2_single_value('replaygain_track_peak'),
		'TXXX:replaygain_track_gain': id3v2_single_value('replaygain_track_gain'),
		'TXXX:replaygain_album_gain': id3v2_single_value('replaygain_album_gain'),
	}

	APEV2_MAP = {
		'REPLAYGAIN_ALBUM_GAIN': ape_text('replaygain_album_gain'),
		'REPLAYGAIN_ALBUM_PEAK': ape_text('replaygain_album_peak'),
		'REPLAYGAIN_TRACK_GAIN': ape_text('replaygain_track_gain'),
		'REPLAYGAIN_TRACK_PEAK': ape_text('replaygain_track_peak'),
	}

	ASF_MAP = {
		u'WM/TrackNumber': asf_single_value('tracknumber'), #u'WM/TrackNumber': [ASFUnicodeAttribute(u'9')]
		u'WM/AlbumTitle': asf_values('album'), #u'WM/AlbumTitle': [ASFUnicodeAttribute(u'Unbekanntes Album (16.05.2006 20:46:16)')]
		u'WM/AlbumArtist': asf_values('albumartist'), #u'WM/AlbumArtist': [ASFUnicodeAttribute(u'Trentemoeller')]
		u'WM/Genre': asf_values('genre'), #u'WM/Genre': [ASFUnicodeAttribute(u'Elektro')]
		'Author': generic('artist'), #'Author': [u'Trentemoeller']
		'Title': generic('title'), #'Title': [u'Titel 9']
	}

	def _mayignore(self, kind):
		if kind in ("TSSE", "USLT", "TDRC", "TPE2", "TENC",
			"TPUB", "TCMP", "TSRC", "TLAN", "TCOP", "TSO2", "TRSO", "TRSN", "TPE4", "TOPE", "WORS", "TPE3",
			"TCOM", "TIT1", "TOWN", "MCDI", "TIT3", "TIPL",
			"releasecountry", "asin", "metadata_block_picture", "releasestatus", "script", "releasetype", "label", "language", "author", "barcode", "tmpo", "\xa9too", "cpil", "pgap", "\xa9wrt",
			"covr", "comment", "producer", "catalognumber", "format", "WCOP", "TBPM", "license", "TOAL", "PCNT", "isrc", "itunes_cddb_1",
			"performer", "conductor", "mixer", "arranger", "copyright", "discid", "tool version", "tool name", "bpm", "intensity", "discsubtitle", "\xa9cmt", "WM/Lyrics", "WM/MCDI"):
			return True
		prefix, sep, key = kind.partition(":")
		if sep and prefix in ["PRIV", "WXXX", "POPM", "COMM", "APIC", "UFID", "GEOB", "----", "USLT", "WCOM", "TXXX"]:
			return True

		return False

	def _process(self, dst, src, map, kind, path, ignore=set()):
		for k, v in src.iteritems():
			if k not in map:
				k2 = kind, k
				if k2 not in ignore and not self._mayignore(k):
					print "unhandled tag %r in %s:" % (k, path), repr(v)[:1000]
					ignore.add(k2)
				continue
			map[k](dst, v)

	def _doMP4(self, dst, src):
		for k, v in src.iteritems():
			d = self.MP4_MAP.get(k)
			if d:
				dst[d] = v

	def updateFLAC(self, path, m, info):
		doc = {}
		self._process(doc, m, self.FLAC_MAP, "FLAC", path)
		doc["info"] = dict(m.info.__dict__)
		doc["container"] = "flac"
		doc["codec"] = "flac"
		doc["tags"] = ["flac"]

		pictures = []

		for p in m.pictures:
			key, formats = self.updatePicture(p.data)
			if key is None:
				print "broken picture in", path
				continue
			pictures.append({"type": p.type, "desc": p.desc, "key": key, "formats": formats})

		doc["pictures"] = pictures

		# TODO: APev2 (???)
		return doc

	def _apev2(self, doc, path):
		try:
			m = mutagen.apev2.Open(path)
			assert m is not None
			self._process(doc, m, self.APEV2_MAP, "APEv2", path)
			doc["tags"].append("apev2")
		except mutagen.apev2.APENoHeaderError:
			return
		except IOError as e:
			if e.errno != errno.ENOENT:
				raise

	def updateMP3(self, path, m, info):
		doc = {}
		self._process(doc, m, self.ID3V2_MAP, "ID3", path)
		doc["info"] = dict(m.info.__dict__)
		doc["container"] = "mpeg"
		doc["codec"] = "mp3"
		doc["tags"] = ["id3"]
		pictures = []

		for k, p in m.iteritems():
			if k.startswith("APIC:"):
				key, formats = self.updatePicture(p.data)
				if key is None:
					print "broken picture in", path
					continue
				pictures.append({"type": p.type, "desc": p.desc, "key": key, "formats": formats})

		doc["pictures"] = pictures
		self._apev2(doc, path)
		return doc

	def updateOggVorbis(self, path, m, info):
		doc = {}
		self._process(doc, m, self.OGG_MAP, "OGG", path)
		doc["info"] = dict(m.info.__dict__)
		doc["container"] = "ogg"
		doc["codec"] = "vorbis"
		doc["tags"] = ["ogg"]

		pictures = []

		for mbp in m.get("metadata_block_picture", []):
			raw = mbp.decode("base64")
			type, mime_len = struct.unpack_from(">II", raw)
			i = 8 + mime_len
			mime = raw[8:i].decode("ascii", "replace")
			desc_len, = struct.unpack_from(">I", raw, i);
			i += 4 + desc_len
			desc = raw[i-desc_len:i].decode("utf-8", "replace")
			w, h, bpp, colors, l = struct.unpack_from(">IIIII", raw, i)
			i += 20
			data = raw[i:i+l]

			key, formats = self.updatePicture(data)
			if key is None:
				print "broken picture in", path
				continue
			pictures.append({"type": type, "desc": desc, "key": key, "formats": formats})

		doc["pictures"] = pictures
		# TODO: APev2 (???)
		return doc

	def updateMP4(self, path, m, info):
		doc = {}
		self._process(doc, m, self.MP4_MAP, "MP4", path)
		doc["info"] = dict(m.info.__dict__)
		doc["container"] = "mpeg"
		doc["codec"] = "mp4"
		doc["tags"] = ["id4"]
		# TODO: covr
		# TODO: APEv2 (???)
		return doc

	def updateASF(self, path, m, info):
		doc = {}
		self._process(doc, m, self.ASF_MAP, "ASF", path)
		doc["info"] = dict(m.info.__dict__)
		doc["container"] = "asf"
		doc["codec"] = "asf"
		doc["tags"] = ["asf"]
		# TODO: covr
		# TODO: APEv2 (???)
		return doc

	def update(self, path, cookie, version=1, ignore=set()):
		try:
			path = path.decode("UTF-8")
		except UnicodeDecodeError:
			print "invalid file name:", repr(path)
			return
		ext = os.path.splitext(path)[1].lower()
		if ext in (".sid", ".mod", ".stm", ".s3m", ".jpg", ".jpeg"):
			return
		info = self.files.get(path)
		try:
			st = os.lstat(path)
		except OSError as e:
			if e.errno not in (errno.ENOENT, errno.EACCES):
				raise
			if info is not None:
				self.remove(path, False)
			return

		if info is not None and st.st_mtime == info["mtime"] and st.st_size == info["size"] and version <= info.get("version", 0):
			if info.get("cookie") != cookie:
				info["cookie"] = cookie
				self.files[path] = info
			return

		#print "processing file", path
		m = None
		try:
			m = mutagen.File(path)
		except mutagen.mp3.HeaderNotFoundError:
			print "invalid mp3 file:", path
		except mutagen.mp4.MP4StreamInfoError:
			print "invalid mp4 file:", path
		except IOError as e:
			if e.errno == errno.ENOENT:
				pass
			else:
				print "unknown error %s while parsing %s" % (e, path)
		except UnboundLocalError:
			print "mutagen error", path
		except Exception as e:
			print "weird error %s while parsing %s" % (e, path)
		if m is None:
			return

		try:
			s = self.scanner[type(m)]
		except KeyError:
			if type(m) not in ignore:
				print "unhandled type %s: %s" % (type(m), path)
				ignore.add(type(m))
			return

		old = info
		info = s(path, m, info)
		info["mtime"] = st.st_mtime
		info["size"] = st.st_size
		info["version"] = version
		info["cookie"] = cookie
		if old is not None:
			info["_rev"] = old["_rev"]

		#print path
		#print info
		self.files[path] = info
		#print "done processing file"

	def move(self, srcPath, dstPath):
		for row in self.files.view("_design/db/_view/path")[srcPath]:
			old_id = row.id
			assert old_id.startswith(srcPath)
			new_id = dstPath + old_id[len(srcPath):]
			doc = dict(self.files[old_id])
			doc.pop("_id")
			temp = self.files.get(new_id)
			if temp is not None:
				doc["_rev"] = temp["_rev"]
			else:
				doc.pop("_rev")
			self.files[new_id] = doc
			del self.files[old_id]

	def remove(self, path, isDir):
		if not isDir:
			try:
				del self.files[path]
			except couchdb.ResourceNotFound:
				pass
			return
		for row in self.files.view("_design/db/_view/path")[path]:
			assert row.id.startswith(path)
			del self.files[row.id]
