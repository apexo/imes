import os
import struct
import random
import errno
import socket
import collections
import traceback

from src.fade import Blender, LookAhead, Stable, SoxDecoder, EOF, SampleCounter, Skipper, Joiner, zeroer, Pauser
from src.lame import Encoder
from src.ipc import Async
from src.reactor import Reactor, clock

LOOK_AHEAD = 5 * 44100
PREROLL_LIMIT = 11520
REWIND = 5 * 44100
SILENCE = b'LAME3.99.5UUUUUUUUUUUUUUUUUUUUUUUUU\xff\xfb\x10d\xdd\x8f\xf0\x00\x00i\x00\x00\x00\x08\x00\x00\r \x00\x00\x01\x00\x00\x01\xa4\x00\x00\x00 \x00\x004\x80\x00\x00\x04UUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUU'

class RTPClock(object):
	""" RTP/MPA clock sequence for MPEG frames (1152 samples @ 44100 Hz) for a 90000 Hz RTP clock """

	# RTP/MPA clock is 90000 Hz, at 1225/32 frames per second this gives us 115200/49 ( = 2351 + 1/49) RTP samples per frame
	def __init__(self, initial=None):
		if initial is None:
			self.value = 0
			self.clock49 = 0
		elif isinstance(initial, tuple):
			self.value, self.clock49 = initial
		else:
			self.value = initial.clock
			self.clock49 = initial.clock49

	def export(self):
		return self.value, self.clock49

	def next(self):
		self.value += 2351
		self.clock49 += 1
		if self.clock49 == 49:
			self.value += 1
			self.clock49 = 0
		if self.value >= 2**32:
			self.value -= 2**32

class MediaStream(object):
	MAGIC = (0
			| (2 << 14) # version = 2
			| (0 << 13) # padding = 0
			| (0 << 12) # X = 0
			| (0 << 8) # CC = 0
			| (0 << 7) # M = 0
			| (14) # PT = 14
		)

	HDR = struct.Struct("!HHII")

	def __init__(self, socket, ssrc, rtpAddr, paused=False, clock=(0, 0), seqNo=None):
		self.isPaused = self.shouldBePaused = paused
		self.socket = socket
		self.ssrc = ssrc
		self.rtpAddr = rtpAddr
		self.clock = RTPClock(clock)
		self.seqNo = random.randint(0, 65535) if seqNo is None else seqNo

	def export(self):
		return self.clock.export(), self.seqNo

	def send(self, payload):
		hdr = self.HDR.pack(self.MAGIC, self.seqNo, self.clock.value, self.ssrc)
		try:
			self.socket.sendto(hdr + payload, self.rtpAddr)
		except socket.error as e:
			if e.errno != errno.ECONNREFUSED:
				raise

		self.seqNo = (self.seqNo + 1) & 0xFFFF
		self.clock.next()

	def update(self, sender_ssrc, loss, last, jitter, lsr, dlsr):
		self.refresh()

class MPEGClock(object):
	""" real time sequence for MPEG frames (1152 samples @ 44100 Hz) """

	# an MPEG 1 Layer 3 frame has 1152 samples, at 44110 Hz this gives us 1225/32 frames per second
	def __init__(self, initial=None):
		if initial is None or isinstance(initial, (int, float)):
			c = clock() if initial is None else initial
			self.clock = int(c)
			self.clock1225 = int((c - self.clock) * 1225.0 + 0.5)
			if self.clock1225 >= 1225:
				self.clock += 1
				self.clock1225 -= 1225
		else:
			self.clock = initial.clock
			self.clock1225 = initial.clock1225

	@property
	def value(self, _1225 = 1.0 / 1225):
		return self.clock + self.clock1225 * _1225

	def adjust(self, dt):
		""" adjust for non-monotonic time """
		idt = int(dt)
		frac = int((dt - idt) * 1225.0 + 0.5)
		self.clock += idt
		self.clock1225 += frac
		if self.clock1225 < 0:
			self.clock1225 += 1225
			self.clock -= 1
		elif self.clock1225 >= 1225:
			self.clock1225 -= 1225
			self.clock += 1

	def next(self):
		self.clock1225 += 32
		if self.clock1225 >= 1225:
			self.clock += 1
			self.clock1225 -= 1225

class Channel(object):
	def __init__(self, socket, reactor):
		self.socket = socket
		self.reactor = reactor
		self.jitterBuffer = 0.2
		self.mediaStreams = {}
		self._fetching = False
		self.autoPaused = True
		self._think = False
		self.queue = collections.deque(maxlen=int((self.jitterBuffer*1225+31+32)/32))
		self.hasHttpStreams = False
		self.allHttpStreamsArePaused = False

	def getMasterApi(self):
		return {
			"addMediaStream": self.addMediaStream,
			"removeMediaStream": self.removeMediaStream,
			"pauseMediaStream": self.pauseMediaStream,
			"setHasHttpStreams": self.setHasHttpStreams,
		}

	def getWorkerApi(self):
		return {}

	@classmethod
	def fork(cls, socket, db, name, m2c_r, c2m_w, m2w_r, w2m_w, *close_fds):
		c2w_r, c2w_w = os.pipe()
		w2c_r, w2c_w = os.pipe()

		channel_pid = os.fork()
		if channel_pid:
			os.close(m2c_r)
			os.close(c2m_w)
			os.close(w2c_r)
			os.close(c2w_w)

			worker_pid = Worker.fork(db, name, m2w_r, w2m_w, c2w_r, w2c_w, *close_fds)
			return channel_pid, worker_pid

		db.resource.session.conns.clear()

		print "enter: channel processor", name
		os.close(m2w_r)
		os.close(w2m_w)
		os.close(c2w_r)
		os.close(w2c_w)
		for fd in close_fds:
			os.close(fd)

		reactor = Reactor()
		channel = Channel(socket, reactor)
		master = Async(channel.getMasterApi(), m2c_r, c2m_w, reactor)
		worker = Async(channel.getWorkerApi(), w2c_r, c2w_w, reactor)
		master.essential = worker.essential = True
		channel.start(master, worker)
		try:
			reactor.run()
		except (KeyboardInterrupt, SystemExit):
			pass
		except:
			traceback.print_exc()
		print "exit: channel processor", name
		raise SystemExit()

	def start(self, master, worker):
		self.master = master
		self.worker = worker
		self.playClock = MPEGClock()
		self.queueClock = MPEGClock(self.playClock)
		self.reactor.registerMonotonicClock(self.playClock)
		self.reactor.registerMonotonicClock(self.queueClock)
		self.reactor.scheduleMonotonic(self.playClock.value, self._play)
		self._fetch()

	def destroy(self):
		raise SystemExit()

	def setHasHttpStreams(self, value, allPaused):
		self._think = True
		self.hasHttpStreams = value
		self.allHttpStreamsArePaused = allPaused

	def addMediaStream(self, ssrc, *args):
		self._think = True
		assert ssrc not in self.mediaStreams
		self.mediaStreams[ssrc] = MediaStream(self.socket, ssrc, *args)

	def removeMediaStream(self, ssrc, callback=None):
		ms = self.mediaStreams.pop(ssrc, None)
		if ms is not None:
			self._think = True
		result = None if ms is None else ms.export()
		if callback is not None:
			callback(result)
		if not self.hasHttpStreams and not self.mediaStreams:
			self.worker.destroy()
			self.destroy()

	def pauseMediaStream(self, ssrc, paused):
		ms = self.mediaStreams.get(ssrc)
		if ms is not None:
			self._think = True
			ms.shouldBePaused = paused

	def _autoPausedNow(self, value):
		self.autoPaused = True
		for ms in self.mediaStreams.itervalues():
			ms.isPaused = False

	def _doThink(self):
		if self.autoPaused is None:
			return
		self._think = False
		if self.autoPaused:
			if (self.hasHttpStreams and not self.allHttpStreamsArePaused) or not all(ms.shouldBePaused for ms in self.mediaStreams.itervalues()):
				for ms in self.mediaStreams.itervalues():
					ms.isPaused = ms.shouldBePaused
				self.autoPaused = False
				self.worker.setAutoPaused(False)
			return
		if (not self.hasHttpStreams or self.allHttpStreamsArePaused) and all(ms.shouldBePaused for ms in self.mediaStreams.itervalues()):
			self.autoPaused = None
			self.worker.setAutoPaused(True, callback=self._autoPausedNow)
		else:
			for ms in self.mediaStreams.itervalues():
				ms.isPaused = ms.shouldBePaused

	def _fetch(self):
		assert not self._fetching
		if self.queueClock.value < clock() + self.jitterBuffer:
			self._fetching = True
			if self._think:
				self._doThink()
			self.worker.fetch(callback=self._feed)

	def _feed(self, data):
		self.queue.append(data)

		self.queueClock.next()

		if self.queueClock.value < clock() + self.jitterBuffer:
			self.worker.fetch(callback=self._feed)
		else:
			self._fetching = False

	def _play(self, t):
		pc = self.playClock.value
		while pc <= t:
			payload = self.queue.popleft() if self.queue else SILENCE
			for ms in self.mediaStreams.itervalues():
				ms.send(SILENCE if ms.isPaused else payload)
			if self.hasHttpStreams:
				self.master.push(payload)
			self.playClock.next()
			pc = self.playClock.value

		self.reactor.scheduleMonotonic(pc, self._play)

		if not self._fetching:
			self._fetch()

REPLAY_GAIN = {
	"album": lambda info: info.get("replaygain_album_gain", info.get("replaygain_track_gain", "0.0 dB")),
	"track": lambda info: info.get("replaygain_track_gain", "0.0 dB"),
	"none": lambda info: "0.0 dB",
}

class Worker(object):
	def __init__(self, db, name, reactor):
		self.db = db
		self.name = name

		self.currentInfo = None
		self.currentPosition = None

		self.src = Stable(EOF, True)
		self.reactor = reactor

		self.blendTime = 44100 // 2

		self.temp = bytearray("\x00" * 2048)
		self.view = memoryview(self.temp)

		self.status = self.db.get(self.key, {})
		self.status.setdefault("type", "imes:channel")
		self.status.setdefault("paused", False)
		self.playlist = u"playlist:channel:" + self.name
		if "current" not in self.status:
			self.status["current"] = {
				"plid": self.playlist + ":",
				"idx": 0,
				"fid": "",
				"pos": 0,
			}

		self.setReplayGainMode(self.status.get("replayGain", "album"))
		self.psrc = Pauser(self.src, self.blendTime, self._paused, True)
		self.encoder = Encoder(self.psrc)
		self.autoPaused = True

		self._pausedCb = []

	@classmethod
	def fork(cls, db, name, m2w_r, w2m_w, c2w_r, w2c_w, *close_fds):
		pid = os.fork()
		if pid:
			os.close(m2w_r)
			os.close(w2m_w)
			os.close(c2w_r)
			os.close(w2c_w)
			return pid

		for fd in close_fds:
			os.close(fd)

		db.resource.session.conns.clear()

		print "enter: channel worker", name
		reactor = Reactor()
		worker = Worker(db, name, reactor)
		master = Async(worker.getMasterApi(), m2w_r, w2m_w, reactor)
		channel = Async(worker.getChannelApi(), c2w_r, w2c_w, reactor)
		master.essential = worker.essential = True
		worker.start(channel, master)
		try:
			reactor.run()
		except (KeyboardInterrupt, SystemExit):
			pass
		except:
			traceback.print_exc()
		worker.updateStatus()
		print "exit: channel worker", name
		raise SystemExit()

	def _paused(self):
		while self._pausedCb:
			self._pausedCb.pop(0)(None)

	def _autoStart(self, t):
		if self.src.src is EOF and not self.status["paused"]:
			self._enqueueNext(None)
		else:
			self.reactor.scheduleMonotonic(t + 5, self._autoStart)

	def getChannelApi(self):
		return {
			"fetch": self.fetch,
			"setAutoPaused": self.setAutoPaused,
			"destroy": self.destroy,
		}

	def fetch(self, callback):
		n = self.encoder.read_into(self.view, 0, len(self.view))
		callback(self.view[:n].tobytes())

	def setPaused(self, paused):
		self.psrc.pause(self.autoPaused or paused)
		self.status["paused"] = paused
		self.updateStatus()

	def getStatus(self, callback):
		if self.currentPosition is not None:
			currentlyPlaying = {
				"plid": self.currentInfo["plid"],
				"idx": self.currentInfo["idx"],
				"fid": self.currentInfo["fid"],
				"pos": self.currentInfo["pos"] + self.currentPosition.samples,
			}
		else:
			currentlyPlaying = None
		callback({
			"currentlyPlaying": currentlyPlaying,
			"savedPosition": self.status["current"],
			"paused": self.status["paused"],
			"autoPaused": self.autoPaused,
		})

	def setAutoPaused(self, autoPaused, callback=None):
		self.autoPaused = autoPaused
		self.psrc.pause(self.autoPaused or self.status["paused"])
		if callback is not None:
			assert autoPaused
			if self.psrc.state == "paused":
				callback(None)
			else:
				self._pausedCb.append(callback)

	def getMasterApi(self):
		return {
			"setReplayGainMode": self.setReplayGainMode,
			"getReplayGainMode": self.getReplayGainMode,
			"destroy": self.destroy,
			"play": self.play,
			"getStatus": self.getStatus,
			"setPaused": self.setPaused,
		}

	def getReplayGainMode(self, callback):
		callback(self.status["replayGain"])

	def setReplayGainMode(self, mode):
		self.replayGain = REPLAY_GAIN[mode]
		if self.status.get("replayGain") != mode:
			self.status["replayGain"] = mode
			self.updateStatus()

	def destroy(self):
		raise SystemExit()

	def play(self, plid, idx, fid, pos=0, callback=None):
		if self.status["paused"]:
			self.setPaused(False)
		result = self._play(None, plid, idx, fid, pos)
		if callback is not None:
			callback(result)

	def start(self, channel, master):
		self.channel = channel
		self.master = master

		self._autoStart(clock())

	def _startBlending(self, la):
		if la.info["prerolled"] is None:
			la.info["tooLate"] = True
			return la
		self.currentPosition = SampleCounter(la.info["prerolled"])
		self.currentInfo = la.info["info"]
		self.updateStatus()
		return Blender(la, self.currentPosition, self.blendTime)

	def _play(self, la, plid, idx, fid, pos):
		info = {"plid": plid, "idx": idx, "fid": fid, "pos": pos}
		if not self.getFileInfo(info):
			# erroneous playlist entry
			return False
		self._preroll(la, info)
		return True

	def _enqueueNext(self, la):
		if self.currentInfo is not None:
			self.master.scrobble(self.currentInfo["fid"])
		e = self.getNextPlaylistEntry(self.status, la is not None)
		if e is None or not self._play(la, *e):
			update = False
			if self.status["current"]["fid"]:
				self.status["current"]["idx"] += 1
				self.status["current"]["pos"] = 0
				self.status["current"]["fid"] = ""
				update = True
			if self.currentPosition is not None:
				self.currentPosition = self.currentInfo = None
				update = True
			if update:
				self.updateStatus()
			self.reactor.scheduleMonotonic(clock() + 5, self._autoStart)
		return la

	def _preroll(self, la, info):
		info2 = {"tooLate": False, "prerolled": None, "info": info}
		decoder = SoxDecoder(info["path"], self.reactor, self.replayGain(info))
		if info["pos"] > 0:
			skipped = Skipper(decoder, info["pos"])
		else:
			skipped = decoder
		nla = LookAhead(skipped, LOOK_AHEAD, self._enqueueNext)

		self.reactor.deferIdle(self._doPreroll, nla, info2)

		if la is None or la.remaining <= self.blendTime:
			info2["tooLate"] = True
			return la
		else:
			la.limit = self.blendTime
			la.callback = self._startBlending
			la.info = info2
			return la

	def _doPreroll(self, nla, info):
		if not nla.preroll(PREROLL_LIMIT):
			self.reactor.deferIdle(self._doPreroll, nla, info)
			return
		if not info["tooLate"]:
			info["prerolled"] = nla
			return
		self.currentPosition = SampleCounter(nla)
		self.currentInfo = info["info"]
		self.updateStatus()
		if self.src.src is EOF:
			self.src.src = self.currentPosition
		else:
			self.src.src = Blender(Joiner(self.src.src, zeroer), self.currentPosition, self.blendTime)

	def getFileInfo(self, info):
		try:
			e = self.db[info["fid"]]
		except KeyError:
			return False
		info["path"] = e["path"]
		try:
			info["length"] = e["info"]["length"]
		except KeyError:
			pass
		for k in ("replaygain_album_gain", "replaygain_track_gain"):
			if k in e:
				info[k] = e[k]
		return True

	def getNextPlaylistEntry(self, status, next_=True):
		v = self.db.view("_all_docs", limit=2, include_docs=True)

		key = status["current"]["plid"]
		pos = max(0, status["current"]["pos"] - REWIND)
		idx = status["current"]["idx"]
		skip = status["current"]["fid"] if next_ else ""

		for entry in v[key:]:
			entry = entry.doc
			if not entry["_id"].startswith(self.playlist + ":"):
				return
			for id_ in entry["items"][idx:]:
				if id_ is None or id_ == skip:
					pos = 0
					idx += 1
				else:
					return entry["_id"], idx, id_, pos
			pos = idx = 0

	@property
	def key(self):
		return u"channel:" + self.name

	def create(self):
		self.db[self.key] = {
			"type": "channel",
			"name": "name"
		}

	def updateStatus(self):
		if self.currentPosition is not None:
			self.status["current"] = {
				"plid": self.currentInfo["plid"],
				"idx": self.currentInfo["idx"],
				"fid": self.currentInfo["fid"],
				"pos": self.currentInfo["pos"] + self.currentPosition.samples,
			}
		self.db[self.key] = self.status
