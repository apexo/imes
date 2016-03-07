# small img (64x64?), artist, track, title, artist id, track id, disc id, 

# Release - Disk - Track
# Track - Artist
# Release - Artist

import mutagen
import mutagen.flac
import mutagen.mp3
import mutagen.mp4
import mutagen.oggvorbis
import mutagen.oggopus
import mutagen.apev2
import mutagen.asf
import mutagen.musepack
import couchdb
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
import re
import json

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
	".svg": "image/svg+xml",
}

CRE_REPLACE = re.compile("^.*%%%([A-Z_]+)%%%$")
CRE_MBID = re.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

def _id(d):
	# base64 uses + and /, which are not very safe to include in URL path
	# base64url uses - and _ instead
	# since we cannot use _ at the beginning of document id, we use . instead
	return d.encode("base64")[:(len(d)*8+5) // 6].replace("+", "-").replace("/", ".")

def sha1_id(data):
	return _id(hashlib.sha1(data).digest())

class Database(object):
	def __init__(self, url, db_name, backend, rtsp_backend, delegate_backend):
		self.scanner = {
			mutagen.flac.FLAC: self.updateFLAC,
			mutagen.mp3.MP3: self.updateMP3,
			mutagen.oggvorbis.OggVorbis: self.updateOggVorbis,
			mutagen.oggopus.OggOpus: self.updateOggOpus,
			mutagen.mp4.MP4: self.updateMP4,
			mutagen.asf.ASF: self.updateASF,
			mutagen.musepack.Musepack: self.updateMPC,
		}
		self._session = couchdb.http.Session()
		self._db = couchdb.Server(url, session=self._session)
		self.db = self._create(db_name)
		self._temp = None
		self._well_known = set()

		self._replace = {
			"DB_URL": url,
			"DB_NAME": db_name,
			"BACKEND": backend,
			"RTSP_BACKEND": rtsp_backend,
			"DELEGATE_BACKEND": delegate_backend,
		}

		try:
			self.db["_security"] = json.loads(open("res/security", "rb").read().decode("UTF-8"))
		except KeyError:
			# couchdb module tries to read id & rev from result,
			# but since _security is not versioned, this will fail;
			# however, update should succeed
			pass

	def cleanConnCache(self):
		if hasattr(self._session, "connection_pool"):
			self._session.connection_pool.conns.clear()
		else:
			self._session.conns.clear()

	def _update_designs(self, basepath="res/design"):
		for name in os.listdir(basepath):
			path = os.path.join(basepath, name)
			if os.path.isdir(path) and name and not name.startswith("_"):
				self._update_design(path, name)

	def _update_design(self, basepath, name):
		d = self.db.get("_design/" + name, {})

		self._update_views(d, os.path.join(basepath, "views"))
		self._update_filters(d, os.path.join(basepath, "filters"))
		self._update_misc(d, basepath)

		self.db["_design/" + name] = d
		self._well_known.add("_design/" + name)

	def _update_views(self, d, basepath):
		views = {}

		for name in os.listdir(basepath):
			path = os.path.join(basepath, name)
			if not name.startswith("_") and os.path.isfile(path):
				if name.endswith(".map.js"):
					views.setdefault(name[:-7], {})["map"] = open(path, "rb").read().decode("UTF-8")
				elif name.endswith(".reduce.js"):
					views.setdefault(name[:-10], {})["reduce"] = open(path, "rb").read().decode("UTF-8")

		if not views:
			d.pop("views", None)
		else:
			d["views"] = views

	def _update_filters(self, d, basepath):
		filters = {}

		try:
			for name in os.listdir(basepath):
				path = os.path.join(basepath, name)
				if not name.startswith("_") and name.endswith(".js") and os.path.isfile(path):
					filters[name[:-3]] = open(path, "rb").read().decode("UTF-8")
		except OSError as e:
			if e.errno != errno.ENOENT:
				raise

		if not filters:
			d.pop("filters", None)
		else:
			d["filters"] = filters

	def _update_misc(self, d, basepath):
		d.pop("validate_doc_update", None)
		path = os.path.join(basepath, "validate_doc_update.js")
		if os.path.isfile(path):
			d["validate_doc_update"] = open(path, "rb").read().decode("UTF-8")

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
		a = self.db.get("app", {})
		self.db["app"] = a

		for f in glob.glob("app/*"):
			name = os.path.split(f)[1]
			self.db.put_attachment(a, self._do_replace(open(f)), name, CTYPE_MAP[os.path.splitext(name)[1]])

		self._well_known.add("app")

	def update_data(self, path):
		p = os.getcwd()
		try:
			os.chdir(os.path.join(p, path))

			self._update_designs()
			self._update_app()
		finally:
			os.chdir(p)

	def prepare(self):
		temp = set()
		for row in self.db.view("_all_docs"):
			if row.id.startswith("playlist:") or row.id.startswith("imes:") or row.id.startswith("channel:") or row.id.startswith("history:"):
				continue
			temp.add(row.id)
		self._temp = temp - self._well_known

	def cleanup(self):
		print("cleaning up %d objects" % (len(self._temp),))
		for id in self._temp:
			del self.db[id]

	def search(self, term):
		def view(term, prefix="_design/file/_view/"):
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

		views = [self.db.view(v)[t2:t2 + u"ZZZZZ"] for (v, t2) in (view(t) for t in terms)]
		#print list(views[0])[0]
		keys = set(row.id for row in views[0])
		for view in views[1:]:
			keys &= set(row.id for row in view)

		return sorted(keys)

	def _create(self, name):
		try:
			return self._db[name]
		except couchdb.ResourceNotFound:
			pass
		try:
			return self._db.create(name)
		except couchdb.PreconditionFailed:
			pass
		return self._db[name]

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
		pic = self.db.get(k)
		if pic is not None and pic.get("type") != "picture":
			raise KeyError("hash collision")
		if pic is not None and "inprogress" not in pic and pic.get("version", 0) >= version and len(pic.get("_attachments", {})) > 0:
			self._temp.discard(k)
			return k, pic["formats"]
		if pic is not None:
			del self.db[k]

		try:
			img = PIL.Image.open(StringIO.StringIO(data))
			mime, ext = MIME_MAP[img.__class__]
			attach = []
			formats = {}
			formats["base"] = {"w": img.size[0], "h": img.size[1], "m": mime, "f": "base" + ext}
			attach.append(("base" + ext, data, mime))

			if img.mode == "P":
				img = img.convert("RGB")

			doc = {"formats": formats, "inprogress": True, "version": version, "type": "picture"}

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

			self.db[k] = doc
		except IOError:
			return None, None

		for name, data, mime in attach:
			self.db.put_attachment(doc, data, name, mime)

		doc = self.db[k]
		doc.pop("inprogress")
		self._temp.discard(k)
		self.db[k] = doc

		return k, formats

	def mbids(dstkey):
		def f(dst, value):
			values = sum((v.split("/") for v in value), [])
			if not all(CRE_MBID.match(v) for v in values):
				print("invalid %s: %r" % (dstkey, value))
			else:
				dst[dstkey] = values
		f.__name__ = 'set_mbid_' + dstkey
		return f

	def id3v2_txxx_mbids(dstkey):
		def f(dst, value):
			values = sum((v.split("/") for v in value.text), [])
			if not all(CRE_MBID.match(v) for v in values):
				print("invalid %s: %r" % (dstkey, value))
			else:
				dst[dstkey] = values
		f.__name__ = 'set_id3v2_txxx_mbid_' + dstkey
		return f

	def id3v2_ufid_mbid(dstkey):
		def f(dst, value):
			values = [value.data]
			if not all(CRE_MBID.match(v) for v in values):
				print("invalid %s: %r" % (dstkey, value))
			else:
				dst[dstkey] = values
		f.__name__ = 'set_id3v2_ufid_mbid_' + dstkey
		return f

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
				print("invalid %s value: %r" % (dst1, value))
			if slash:
				try:
					dst[dst2] = int(b)
				except ValueError:
					print("invalid %s value: %r" % (dst2, value))
		f.__name__ = 'set_int_pair_%s_and_%s' % (dst1, dst2)
		return f

	def single_value(dstkey):
		def f(dst, value):
			dst[dstkey] = value[0].rstrip("\x00")
		f.__name__ = 'set_single_value_' + dstkey
		return f

	def m4a_rg(dstkey, suffix=""):
		def f(dst, value):
			v = value[0]
			try:
				float(v)
			except ValueError:
				print("invalid %s: %r" % (dstkey, value))
			dst[dstkey] = v + suffix
		f.__name__ = 'set_m4a_rg_' + dstkey
		return f

	def id3v2_numpair(dst1, dst2):
		def f(dst, value):
			a, slash, b = value.text[0].partition("/")
			try:
				dst[dst1] = int(a)
			except ValueError:
				print("invalid %s value: %r" % (dst1, value))
			if slash:
				try:
					dst[dst2] = int(b)
				except ValueError:
					print("invalid %s value: %r" % (dst2, value))
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

	def ape_text(dstkey, listify=False):
		def f(dst, value):
			assert value.kind == 0
			v = value.value.decode("UTF-8")
			if listify:
				v = [v]
			dst[dstkey] = v
		f.__name__ = 'set_ape_text_' + dstkey
		return f

	ape_text_utf8 = ape_text

	def ape_text_number_pair(dst1, dst2):
		def f(dst, value):
			a, slash, b = value.value.partition("/")
			try:
				dst[dst1] = int(a)
			except ValueError:
				print("invalid %s value: %r" % (dst1, value))
			if slash:
				try:
					dst[dst2] = int(b)
				except ValueError:
					print("invalid %s value: %r" % (dst2, value))
		f.__name__ = 'set_ape_text_number_pair_%s_and_%s' % (dst1, dst2)
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
		'----:com.apple.iTunes\x00:replaygain_album_gain\x00': m4a_rg('replaygain_album_gain', ' dB'),
		'----:com.apple.iTunes\x00:replaygain_track_gain\x00': m4a_rg('replaygain_track_gain', ' dB'),
		'----:com.apple.iTunes\x00:replaygain_album_peak\x00': m4a_rg('replaygain_album_peak'),
		'----:com.apple.iTunes\x00:replaygain_track_peak\x00': m4a_rg('replaygain_track_peak'),
		'----:com.apple.iTunes:MusicBrainz Artist Id': mbids('musicbrainz_artistid'),
		'----:com.apple.iTunes:MusicBrainz Track Id': mbids('musicbrainz_trackid'),
		'----:com.apple.iTunes:MusicBrainz Album Id': mbids('musicbrainz_albumid'),
		'----:com.apple.iTunes:MusicBrainz Album Artist Id': mbids('musicbrainz_albumartistid'),
		'----:com.apple.iTunes:MusicBrainz Disc Id': mbids('musicbrainz_discid'),
		'----:com.apple.iTunes:DISCSUBTITLE': generic('discsubtitle'),
		'soaa': generic('albumartistsort'),
		'soar': generic('artistsort'),
		'soal': generic('albumsort'),
		'sonm': generic('titlesort'),
		'soco': generic('composersort'),
		'aART': generic('albumartist'),
		'\xa9wrt': generic('composer'),
	}

	# {'tmpo': [0], '\xa9too': [u'iTunes v7.4.3.1, QuickTime 7.2'], 'cpil': False, '----:com.apple.iTunes:iTunSMPB': [' 00000000 00000840 00000048 00000000002A4B78 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000'], '----:com.apple.iTunes:iTunes_CDDB_IDs': ['11+78B21AEA2DF89AFC94288091A11803DE+1262221'], 'pgap': False, '----:com.apple.iTunes:iTunNORM': [' 000000FC 00000130 00002D95 00001B27 0000B7A4 0000B7A4 00005240 000062C4 0000F010 0000F010']}

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
		'musicbrainz_albumartistid': mbids('musicbrainz_albumartistid'),
		'musicbrainz_artistid': mbids('musicbrainz_artistid'),
		'musicbrainz_trackid': mbids('musicbrainz_trackid'),
		'musicbrainz_discid': mbids('musicbrainz_discid'),
		'musicbrainz_albumid': mbids('musicbrainz_albumid'),
		'date': single_value('date'),
		'originaldate': single_value('originaldate'),
		'albumartistsort': generic('albumartistsort'),
		'artistsort': generic('artistsort'),
		'albumartist': generic('albumartist'),
		'genre': generic('genre'),
		'discnumber': int_pair('discnumber', 'totaldiscs'),
		'totaldiscs': single_int('totaldiscs'),
		'disctotal': single_int('totaldiscs'),
		'media': single_value('media'),
		'composer': generic('composer'),
		'discsubtitle': generic('discsubtitle'),
	}

	OGG_MAP = FLAC_MAP

	# {'tool version': [u'14.0.147\x00'], , 'bpm': [u'73\x00'], , , 'intensity': [u'4\x00'], , 'tool name': [u'Media Center\x00'], , }
	# {'replaygain_reference_loudness': [u'89.0 dB']}
	# {'replaygain_reference_loudness': [u'89.0 dB'], 'releasecountry': [u'DE'], 'media': [u'CD'], 'barcode': [u'4029759081449'], 'releasestatus': [u'official'], 'originaldate': [u'2012-08-03'], 'language': [u'deu'], 'script': [u'Latn'], 'releasetype': [u'album']}

	ID3V2_MAP = {
		"TMED": id3v2_single_value('media'),
		"TXXX:MusicBrainz Album Artist Id": id3v2_txxx_mbids('musicbrainz_albumartistid'),
		"TXXX:MusicBrainz Artist Id": id3v2_txxx_mbids('musicbrainz_artistid'),
		"TXXX:MusicBrainz Album Id": id3v2_txxx_mbids('musicbrainz_albumid'),
		"UFID:http://musicbrainz.org": id3v2_ufid_mbid('musicbrainz_trackid'),
		"TDOR": id3v2_single_value_text('originaldate'),
		"TDRC": id3v2_single_value_text('date'),
		"TPE1": id3v2_values('artist'),
		"TSOP": id3v2_values('artistsort'),
		"TPE2": id3v2_values('albumartist'),
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
		'TSST': id3v2_values('discsubtitle'),
	}

	APEV2_MAP = {
		'REPLAYGAIN_ALBUM_GAIN': ape_text('replaygain_album_gain'),
		'REPLAYGAIN_ALBUM_PEAK': ape_text('replaygain_album_peak'),
		'REPLAYGAIN_TRACK_GAIN': ape_text('replaygain_track_gain'),
		'REPLAYGAIN_TRACK_PEAK': ape_text('replaygain_track_peak'),
		'Album': ape_text_utf8('album', True),
		'Album Artist': ape_text_utf8('albumartist', True),
		'Albumartistsort': ape_text_utf8('albumartistsort', True),
		'Artist': ape_text_utf8('artist', True),
		'Artistsort': ape_text_utf8('artistsort', True),
		#'Asin':
		#'Barcode':
		#'CatalogNumber':
		'Composer': ape_text_utf8('composer', True),
		#'Cover Art (Front)': ape_cover(#TODO),
		'Disc': ape_text_number_pair('discnumber', 'totaldiscs'),
		#'Label':
		#'Language':
		#'MUSICBRAINZ_ALBUMSTATUS':
		#'MUSICBRAINZ_ALBUMTYPE':
		#'Media',
		'Musicbrainz_Albumartistid': ape_text('musicbrainz_albumartistid', True),
		'Musicbrainz_Albumid': ape_text('musicbrainz_albumid', True),
		'Musicbrainz_Artistid': ape_text('musicbrainz_artistid', True),
		'Musicbrainz_Trackid': ape_text('musicbrainz_trackid', True),
		#'Originaldate':
		#'Releasecountry':
		#'Script':
		'Title': ape_text_utf8('title', True),
		'Track': ape_text_number_pair('tracknumber', 'totaltracks'),
		'Originaldate': ape_text('date'),
		'Year': ape_text('date'),
		#'comment':
		'genre': ape_text_utf8('genre', True),
		'DiscSubtitle': ape_text_utf8('discsubtitle', True),
	}

	ASF_MAP = {
		u'WM/TrackNumber': asf_single_value('tracknumber'), #u'WM/TrackNumber': [ASFUnicodeAttribute(u'9')]
		u'WM/PartOfSet': asf_single_value('discnumber'),
		u'WM/AlbumTitle': asf_values('album'), #u'WM/AlbumTitle': [ASFUnicodeAttribute(u'Unbekanntes Album (16.05.2006 20:46:16)')]
		u'WM/AlbumArtist': asf_values('albumartist'), #u'WM/AlbumArtist': [ASFUnicodeAttribute(u'Trentemoeller')]
		u'WM/Genre': asf_values('genre'), #u'WM/Genre': [ASFUnicodeAttribute(u'Elektro')]
		u'WM/Composer': asf_values('composer'),
		u'WM/Year': asf_single_value('date'),
		u'WM/OriginalReleaseYear': asf_single_value('originaldate'),
		'Author': generic('artist'), #'Author': [u'Trentemoeller']
		'Title': generic('title'), #'Title': [u'Titel 9']
		u'MusicBrainz/Track Id': asf_values('musicbrainz_trackid'),
		u'MusicBrainz/Artist Id': asf_values('musicbrainz_artistid'),
		u'MusicBrainz/Album Artist Id': asf_values('musicbrainz_albumartistid'),
		u'MusicBrainz/Album Id': asf_values('musicbrainz_albumid'),
		u'WM/SetSubTitle': asf_values('discsubtitle'),
	}

	def _mayignore(self, kind):
		if kind in ("TSSE", "USLT", "TDRC", "TENC",
			"TPUB", "TCMP", "TSRC", "TLAN", "TCOP", "TSO2", "TRSO", "TRSN", "TPE4", "TOPE", "WORS", "TPE3",
			"TIT1", "TOWN", "MCDI", "TIT3", "TIPL",
			"releasecountry", "asin", "metadata_block_picture", "releasestatus", "script", "releasetype", "label", "language", "author", "barcode", "tmpo", "\xa9too", "cpil", "pgap",
			"covr", "comment", "producer", "catalognumber", "format", "WCOP", "TBPM", "license", "TOAL", "PCNT", "isrc", "itunes_cddb_1",
			"performer", "conductor", "mixer", "arranger", "copyright", "discid", "tool version", "tool name", "bpm", "intensity", "discsubtitle", "\xa9cmt", "WM/Lyrics", "WM/MCDI",
			"coverart", "coverarttype", "coverartmime", "coverartdescription", "MP3GAIN_ALBUM_MINMAX", "MP3GAIN_MINMAX",
			"Cover Art (Front)", "WM/Picture"):
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
					print("unhandled tag %r in %s: %s" % (k, path, repr(v)[:1000]))
					ignore.add(k2)
				continue
			map[k](dst, v)

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
				print("broken picture in %s" % (path,))
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
		except (mutagen.apev2.APEBadItemError, mutagen.apev2.APENoHeaderError):
			return
		except IOError as e:
			if e.errno != errno.ENOENT:
				raise

	def updateMPC(self, path, m, info):
		type_map = {"Cover Art (Front)": 4}
		doc = {}
		self._process(doc, m, self.APEV2_MAP, "APEv2", path)
		doc["info"] = dict(m.info.__dict__)
		doc["container"] = "mpc"
		doc["codec"] = "mpc"
		doc["tags"] = ["apev2"]

		pictures = []

		for k in m:
			if not k.startswith("Cover Art ("):
				continue
			if k not in type_map:
				print("unhandled cover art kind/apev2: %s" % (k,))
				continue
			v = m[k].value
			p = v.find("\x00")
			if not 0 <= p <= 100:
				print("invalid cover art in %s" % (path,))
				continue
			v = v[p+1:]
			key, formats = self.updatePicture(v)
			if key is None:
				print("broken picture in %s" % (path,))
				continue
			pictures.append({"type": type_map[k], "desc": "", "key": key, "formats": formats})

		doc["pictures"] = pictures

		if m.info.title_peak:
			doc["replaygain_track_peak"] = str(m.info.title_peak)
			doc["replaygain_track_gain"] = str(m.info.title_gain) + " dB"

		if m.info.album_peak:
			doc["replaygain_album_peak"] = str(m.info.album_peak)
			doc["replaygain_album_gain"] = str(m.info.album_gain) + " dB"

		return doc

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
					print("broken picture in %s" % (path,))
					continue
				pictures.append({"type": p.type, "desc": p.desc, "key": key, "formats": formats})

		doc["pictures"] = pictures
		self._apev2(doc, path)
		return doc

	def updateOggOpus(self, path, m, info):
		return self.updateOggVorbis(path, m, info, "opus")

	def updateOggVorbis(self, path, m, info, codec="vorbis"):
		doc = {}
		self._process(doc, m, self.OGG_MAP, "OGG", path)
		doc["info"] = dict(m.info.__dict__)
		doc["container"] = "ogg"
		doc["codec"] = codec
		doc["tags"] = ["ogg"]

		pictures = []

		for mbp in m.get("metadata_block_picture", []):
			raw = mbp.decode("base64")
			type, mime_len = struct.unpack_from(">II", raw)
			i = 8 + mime_len
			#mime = raw[8:i].decode("ascii", "replace")
			desc_len, = struct.unpack_from(">I", raw, i);
			i += 4 + desc_len
			desc = raw[i-desc_len:i].decode("utf-8", "replace")
			w, h, bpp, colors, l = struct.unpack_from(">IIIII", raw, i)
			i += 20
			data = raw[i:i+l]

			key, formats = self.updatePicture(data)
			if key is None:
				print("broken picture in %s" % (path,))
				continue
			pictures.append({"type": type, "desc": desc, "key": key, "formats": formats})

		for data, type, mime, desc in zip(m.get("coverart", []), m.get("coverarttype", []), m.get("coverartmime", []), m.get("coverartdescription", [])):
			data = data.decode("ascii").decode("base64")
			type = int(type)

			key, formats = self.updatePicture(data)
			if key is None:
				print("broken picture in %s" % (path,))
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

		pictures = []

		for p in m.get("covr", []):
			key, formats = self.updatePicture(str(p))
			if key is None:
				print("broken picture in %s" % (path,))
				continue
			pictures.append({"type": 3, "desc": u"", "key": key, "formats": formats})
		doc["pictures"] = pictures

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

		pictures = []

		for p in m.get("WM/Picture", []):
			value = p.value
			type = ord(value[0])
			length, = struct.unpack("<I", value[1:5])
			i = 5
			mime = ""
			while value[i:i+2] != "\x00\x00":
				mime += value[i:i+2]
				i += 2
			i += 2
			desc = ""
			while value[i:i+2] != "\x00\x00":
				desc += value[i:i+2]
				i += 2
			i += 2
			if length != len(value[i:]):
				print("broken picture in %s" % (path,))
				continue
			key, formats = self.updatePicture(value[i:])
			if key is None:
				print("broken picture in %s" % (path,))
				continue
			pictures.append({"type": type, "desc": desc, "key": key, "formats": formats})
		doc["pictures"] = pictures
		# TODO: covr
		# TODO: APEv2 (???)
		return doc

	def update(self, path, version=1, ignore=set()):
		try:
			dpath = path.decode("UTF-8")
		except UnicodeDecodeError:
			print("invalid file name: %r" % (path,))
			return
		ext = os.path.splitext(path)[1].lower()
		if ext in (".sid", ".mod", ".stm", ".s3m", ".jpg", ".jpeg"):
			return
		k = sha1_id(path)
		info = self.db.get(k)
		if info is not None and (info.get("type", "file") != "file" or info.get("path") != dpath):
			raise KeyError("hash collision: %r" % (info,))
		try:
			st = os.lstat(path)
		except OSError as e:
			if e.errno not in (errno.ENOENT, errno.EACCES):
				raise
			if info is not None:
				self.remove(path, False)
			return

		if info is not None and st.st_mtime == info["mtime"] and st.st_size == info["size"] and version <= info.get("version", 0):
			for p in info.get("pictures", []):
				if not p["key"] in self.db:
					print("missing picture for %s" % (path,))
					break
				self._temp.discard(p["key"])
			else:
				self._temp.discard(k)
				return

		#print "processing file", path
		m = None
		try:
			m = mutagen.File(path)
		except mutagen.mp3.HeaderNotFoundError:
			print("invalid mp3 file: %s" % (path,))
		except mutagen.mp4.MP4StreamInfoError:
			print("invalid mp4 file: %s" % (path,))
		except IOError as e:
			if e.errno == errno.ENOENT:
				pass
			else:
				print("unknown error %s while parsing %s" % (e, path))
		except UnboundLocalError:
			print("mutagen error: %s" % (path,))
		except Exception as e:
			print("weird error %s while parsing %s" % (e, path))
		if m is None:
			return

		try:
			s = self.scanner[type(m)]
		except KeyError:
			if type(m) not in ignore:
				print("unhandled type %s: %s" % (type(m), path))
				ignore.add(type(m))
			return

		old = info

		try:
			info = s(path, m, info)
		except IOError as e:
			if e.errno == errno.EACCES:
				print("access revoked while scanning %s" % (path,))
				if info is not None:
					self.remove(path, False)
				return
			raise

		info["path"] = dpath
		info["type"] = "file"
		info["mtime"] = st.st_mtime
		info["size"] = st.st_size
		info["version"] = version
		if old is not None:
			info["_rev"] = old["_rev"]

		#print path
		#print info
		self._temp.discard(k)
		self.db[k] = info
		#print "done processing file"

	def move(self, srcPath, dstPath):
		for row in self.db.view("_design/file/_view/path")[srcPath]:
			doc = dict(self.db[row.id])
			doc.pop("_id")
			old_path = doc["path"].encode("UTF-8")
			assert old_path.startswith(srcPath)
			new_path = dstPath + old_path[len(srcPath):]
			new_id = sha1_id(new_path)
			doc["path"] = new_path.decode("UTF-8")
			temp = self.db.get(new_id)
			if temp is not None:
				doc["_rev"] = temp["_rev"]
			else:
				doc.pop("_rev")
			self.db[new_id] = doc
			del self.db[row.id]

	def remove(self, path, isDir):
		if not isDir:
			try:
				del self.db[sha1_id(path)]
			except couchdb.ResourceNotFound:
				pass
			return
		for row in self.db.view("_design/file/_view/path")[path]:
			del self.db[row.id]
