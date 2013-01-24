import time
import socket
import random
import struct
import heapq
import collections
import errno
import select

from fade import SoxDecoder
from lame import Encoder
from reactor import clock

SESSION_TIMEOUT = 120
JITTER_BUFFER = 0.2

_expired = clock()

class MediaStream(object):
	MAGIC = (0
			| (2 << 14) # version = 2
			| (0 << 13) # padding = 0
			| (0 << 12) # X = 0
			| (0 << 8) # CC = 0
			| (0 << 7) # M = 0
			| (14) # PT = 14
		)

	HDR = struct.Struct("!HHIII")

	def __init__(self, session, uri, handler):
		self.session = session
		self.uri = uri

		self.clock = RTPClock()
		self.seqNo = random.randint(0, 65535)
		self.handler = handler

		while True:
			self.ssrc = random.randint(0, 2**32-1)
			if self.ssrc not in handler.mediaStreams:
				handler.mediaStreams[self.ssrc] = self
				break

	def send(self, payload):
		if not self.session.expired:
			hdr = self.HDR.pack(self.MAGIC, self.seqNo, self.clock.value, self.ssrc, 0)
			try:
				self.handler.rtp.sendto(hdr + payload, self.session.rtpAddr)
			except socket.error as e:
				if e.errno != errno.ECONNREFUSED:
					raise

		self.seqNo = (self.seqNo + 1) & 0xFFFF
		self.clock.next()

	def update(self, sender_ssrc, loss, last, jitter, lsr, dlsr):
		self.session.refresh()

class Session(object):
	def __init__(self, addr, reactor, handler):
		self.handler = handler
		self.expires = _expired
		self.rtpAddr = addr
		self.rtcpAddr = (addr[0], addr[1] + 1) + addr[2:]
		self.reactor = reactor
		self.mediaStreams = set()

		self.refresh()

		while True:
			self.id = open("/dev/urandom", "rb").read(8).encode("hex")
			if self.id not in handler.sessions:
				self.handler.sessions[self.id] = self
				break

	def refresh(self, timeout=SESSION_TIMEOUT):
		self.expires = clock() + timeout

	def addMediaStream(self, uri):
		ms = MediaStream(self, uri, self.handler)
		self.mediaStreams.add(ms)
		return ms

	def destroy(self):
		for ms in self.mediaStreams:
			self.handler.channel.removeSession(ms)
			self.handler.mediaStreams.pop(ms.ssrc, None)
		self.handler.sessions.pop(self.id, None)

	@property
	def expired(self):
		return clock() > self.expires

_1225 = 1.0 / 1225
SILENCE = b'LAME3.99.5UUUUUUUUUUUUUUUUUUUUUUUUU\xff\xfb\x10d\xdd\x8f\xf0\x00\x00i\x00\x00\x00\x08\x00\x00\r \x00\x00\x01\x00\x00\x01\xa4\x00\x00\x00 \x00\x004\x80\x00\x00\x04UUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUU'

class RTPClock(object):
	""" RTP/MPA clock sequence for MPEG frames (1152 samples @ 44100 Hz) for a 90000 Hz RTP clock """

	# RTP/MPA clock is 90000 Hz, at 1225/32 frames per second this gives us 115200/49 ( = 2351 + 1/49) RTP samples per frame
	def __init__(self, initial=None):
		if initial is None:
			self.value = 0
			self.clock49 = 0
		else:
			self.value = initial.clock
			self.clock49 = initial.clock49

	def next(self):
		self.value += 2351
		self.clock49 += 1
		if self.clock49 == 1:
			self.value += 1
			self.clock49 = 0
		if self.value >= 2**32:
			self.value -= 2**32

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
				self.clock1225 -= 1
		else:
			self.clock = initial.clock
			self.clock1225 = initial.clock1225

	@property
	def value(self):
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
	def __init__(self, rpc, reactor, jitterBuffer=JITTER_BUFFER):
		self.jitterBuffer = jitterBuffer
		self.queue = collections.deque(maxlen=int((jitterBuffer*1225+31+32)/32))
		self.playClock = MPEGClock()
		self.queueClock = MPEGClock()
		self.sessions = set()
		self.hardPausedSessions = set()
		self.pause = True
		self.rpc = rpc
		self.reactor = reactor
		self.reactor.registerMonotonicClock(self.playClock)
		self.reactor.registerMonotonicClock(self.queueClock)

		self._fetching = False
		self._fetch()
		self.reactor.scheduleMonotonic(self.playClock.value, self._play)

	def destroy(self):
		self.reactor.unregisterMonotonicClock(self.playClock)
		self.reactor.unregisterMonotonicClock(self.queueClock)

	def addSession(self, session):
		self.sessions.add(session)
		self.unpauseSession(session)

	def removeSession(self, session):
		self.pauseSession(session)
		self.sessions.discard(session)
		self.hardPausedSessions.discard(session)

	def pauseSession(self, session):
		if session not in self.sessions:
			return
		if len(self.sessions) == 1:
			if not self.pause:
				self.pause = True
				self.rpc.pause()
		else:
			self.sessions.discard(session)
			self.hardPausedSessions.discard(session)

	def unpauseSession(self, session):
		if session in self.hardPausedSessions:
			self.hardPausedSessions.discard(session)
			self.sessions.add(session)
		elif session is self.sessions:
			pass
		else:
			return
		if self.pause:
			self.pause = False
			self.rpc.unpause()

	def _fetch(self):
		assert not self._fetching
		if self.queueClock.value < clock() + self.jitterBuffer:
			self._fetching = True
			self.rpc.fetch(callback=self._feed)

	def _feed(self, data):
		self.queue.append(data)

		self.queueClock.next()

		if self.queueClock.value < clock() + self.jitterBuffer:
			self.rpc.fetch(callback=self._feed)
		else:
			self._fetching = False

	def _play(self, t):
		pc = self.playClock.value
		while pc <= t:
			payload = self.queue.popleft() if self.queue else SILENCE
			for session in self.sessions:
				session.send(payload)
			for session in self.hardPausedSessions:
				session.send(SILENCE)
			self.playClock.next()
			pc = self.playClock.value

		self.reactor.scheduleMonotonic(pc, self._play)

		if not self._fetching:
			self._fetch()

class RTSPConnection(object):
	def __init__(self, addr, sock, reactor, handler):
		self.addr = addr
		self.sock = sock
		self.reactor = reactor
		self.handler = handler
		self.reactor.register(self.sock.fileno(), select.EPOLLIN, self._process)
		self.buf = bytearray("\0"*4096)
		self.view = memoryview(self.buf)
		self.write = 0
		self.read = 0
		self.data = {}
		self.firstLine = None

	def _complete(self):
		print repr(self.firstLine), self.data
		if not self.firstLine:
			raise ValueError("first line missing")
		request, uri, version = self.firstLine.split(None, 2)
		if request == "OPTIONS":
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\nPublic: DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE\r\n\r\n" % self.data["cseq"]
			self.sock.send(response)
		elif request == "DESCRIBE":
			sdp = """v=0
o=- 0 0 IN IP4 0.0.0.0
s=unnamed
c=IN IPV4 0.0.0.0
t=0 0
a=recvonly
m=audio 0 RTP/AVP 14
a=rtpmap:14 mpa/90000/2
"""
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\nContent-Type: application/sdp\r\nContent-Length: %d\r\n\r\n" % (self.data["cseq"], len(sdp)) + sdp
			self.sock.send(response)
		elif request == "SETUP":
			transport = self.data["transport"].split(";")
			if transport[0] != "RTP/AVP" and transport[0] != "RTP/AVP/UDP":
				raise ValueError(transport)
			args = {}
			for arg in transport[1:]:
				h, s, v = arg.partition("=")
				if not s:
					v = True
				args[h] = v
			assert args["unicast"]
			assert args["client_port"]
			plo, eq, phi = args["client_port"].partition("-")
			plo = int(plo)
			session = Session((self.addr[0], plo) + self.addr[2:], self.reactor, self.handler)
			tsp = self.data["transport"] + ";server_port=" + self.handler.server_port
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: %s;timeout=60\r\nTransport: %s\r\n\r\n" % (self.data["cseq"], session.id, tsp)
			self.sock.send(response)
		elif request == "PLAY":
			sessionId = self.data["session"]
			session = self.handler.sessions[sessionId]
			media = session.addMediaStream(uri)
			self.handler.channel.addSession(media)
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: %s\r\n\r\n" % (self.data["cseq"], session.id)
			self.sock.send(response)
		elif request == "TEARDOWN":
			sessionId = self.data["session"]
			session = self.handler.sessions[sessionId]
			session.destroy()
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\n" % (self.data["cseq"])
		else:
			raise ValueError("unsupported request: %s" % (request,))
		self.firstLine = None
		self.data = {}

	def _processLine(self, line):
		if line == b'':
			self._complete()
			return
		if self.firstLine is None:
			self.firstLine = line
			return
		hdr, sep, value = line.partition(": ")
		if not sep:
			raise ValueError(line)
		self.data[hdr.lower().strip()] = value.strip()

	def _process(self, events):
		if events & select.EPOLLHUP:
			self.reactor.unregister(self.sock.fileno())
			self.sock.close()
			return
		if events != select.EPOLLIN:
			raise Exception(events)
		n = self.sock.recv_into(self.view[self.write:])
		if not n:
			# HUP?
			self.reactor.unregister(self.sock.fileno())
			return
		self.write += n
		if self.write == len(self.buf):
			print "buffer overflow"
			self.reactor.unregister(self.sock.fileno())
			return
		p = self.buf.find("\r\n", self.read)
		while p >= self.read:
			self._processLine(self.view[self.read : p].tobytes())
			self.read = p + 2
			p = self.buf.find("\r\n", self.read)
		if self.read:
			self.view[0 : self.write - self.read] = self.view[self.read : self.write]
		#print repr(self.buf)


class RTSPHandler(object):
	def __init__(self, channel, addr, reactor):
		self.channel = channel
		self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
		self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
		self.sock.bind(addr)
		self.sock.listen(4)

		self.rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
		self.rtp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
		self.rtp.bind(("0.0.0.0", 0))

		sn = self.rtp.getsockname()

		self.rtcp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
		self.rtcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
		self.rtcp.bind((sn[0], sn[1] + 1) + sn[2:])

		self.server_port = "%d-%d" % (sn[1], sn[1] + 1)

		self.reactor = reactor
		self.reactor.register(self.sock.fileno(), select.EPOLLIN, self._connection)
		self.reactor.register(self.rtcp.fileno(), select.EPOLLIN, self._onRtcp)
		self.sessions = {}
		self.mediaStreams = {}

	HDR = struct.Struct("!BBH")
	RR = struct.Struct("!I")
	RR_block = struct.Struct("!IIIIII")

	def parse_RR(self, data, ofs, length, rc):
		ofs0 = ofs
		sender_ssrc, = self.RR.unpack_from(data, ofs)
		ofs += 4
		for i in xrange(rc):
			ssrc, loss, last, jitter, lsr, dlsr = self.RR_block.unpack_from(data, ofs)
			mediaStream = self.mediaStreams.get(ssrc)
			if mediaStream is not None:
				mediaStream.update(sender_ssrc, loss, last, jitter, lsr, dlsr)
			#print "sender_ssrc=%s, ssrc=%s, loss=%d, last=%d, jitter=%d, lsr=%d, dlsr=%d" % (sender_ssrc, ssrc, loss, last, jitter, lsr, dlsr)
			ofs += 24
		assert ofs0 + length == ofs, (ofs0, length, ofs)
		return ofs0 + length

	def parse_SDES(self, data, ofs, length, rc):
		return ofs + length
		ofs0 = ofs
		for i in xrange(rc):
			ssrc, = self.RR.unpack_from(data, ofs)
			ofs += 4
			while True:
				key = ord(data[ofs])
				if key == 0:
					ofs += 1
					while ofs & 3:
						assert ord(data[ofs]) == 0
						ofs += 1
					break
				l = ord(data[ofs + 1])
				value = data[ofs + 2 : ofs + 2 + l].decode("UTF-8")
				print "SDES %s: %s" % ({
					1: "CNAME",
					2: "NAME",
					3: "EMAIL",
					4: "PHONE",
					5: "LOC",
					6: "TOOL",
				}[key], value)
				ofs += 2 + l
		assert ofs0 + length == ofs
		return ofs0 + length

	def parse_BYE(self, data, ofs, length, sc):
		return ofs + length

	def _onRtcp(self, events):
		if events != select.EPOLLIN:
			print "??? RTCP", events
			self.reactor.unregister(self.rtcp.fileno())
			return
		try:
			data = self.rtcp.recv(512)
		except socket.error as e:
			if e.errno == errno.EBADF:
				print "??? RTCP EBADF", events
				#self.reactor.unregister(self.rtcp.fileno())
				return
			raise
		ofs = 0
		while ofs < len(data):
			rc, pt, l = self.HDR.unpack_from(data, ofs)
			ofs += 4
			if pt == 201:
				ofs = self.parse_RR(data, ofs, l * 4, rc & 31)
			elif pt == 202:
				ofs = self.parse_SDES(data, ofs, l * 4, rc & 31)
			elif pt == 203:
				ofs = self.parse_BYE(data, ofs, l * 4, rc & 31)
			else:
				print "unsupported PT in RTCP: %d" % pt
				return

	def _connection(self, events):
		if events != select.EPOLLIN:
			raise Exception(events)
		sock, addr = self.sock.accept()
		RTSPConnection(addr, sock, self.reactor, self)


def test():
	from reactor import Reactor

	class RPC(object):
		def __init__(self):
			src = SoxDecoder("/home/apexo/ext/media/Mariah Carey - Without You.mp3", 2)
			self.enc = Encoder(src)
			self.temp = bytearray("\x00" * 2048)
			self.view = memoryview(self.temp)

		def fetch(self, callback):
			n = self.enc.read_into(self.view, 0, len(self.view))
			reactor.defer(callback, self.view[:n].tobytes() if n else SILENCE)

		def pause(self):
			pass
		def unpause(self):
			pass

	reactor = Reactor()
	rpc = RPC()
	channel = Channel(rpc, reactor)
	handler = RTSPHandler(channel, ("0.0.0.0", 9997), reactor)
	reactor.run()


if __name__ == '__main__':
	test()
