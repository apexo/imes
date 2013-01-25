import time
import socket
import random
import struct
import heapq
import collections
import errno
import select
import urlparse

from fade import SoxDecoder
from lame import Encoder
from reactor import clock
from state import State

class Connection(object):
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

	def close(self):
		self.reactor.unregister(self.sock.fileno())
		self.sock.close()

	def _complete(self):
		print repr(self.firstLine), self.data
		if not self.firstLine:
			self.close()
		request, uri, version = self.firstLine.split(None, 2)
		if version.startswith("RTSP/"):
			if version != "RTSP/1.0":
				self.close()
				return
			try:
				self._doRtsp(request, uri, self.data)
			except Exception as e:
				self.sock.send("RTSP/1.0 500 Internal Server Error\r\n\r\n" + str(e) + "\r\n")
				self.close()
			self.firstLine = None
			self.data = {}
			return

		if version.startswith("HTTP/"):
			if version != "HTTP/1.0" and version != "HTTP/1.1":
				self.close()
				return
			try:
				self._doHttp(request, uri, data)
			except Exception as e:
				self.sock.send("HTTP/1.1 500 Internal Server Error\r\n\r\n" + str(e) + "\r\n")
				self.close()
			self.firstLine = None
			self.data = {}
			return

		self.close()
		return

	def _doRtsp(self, request, uri, data):
		if request == "OPTIONS":
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\nPublic: DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE\r\n\r\n" % data["cseq"]
			self.sock.send(response)
			return

		p = urlparse.urlparse(uri)
		path = p.path.strip("/").split("/")
		if len(path) < 3 or path[0] != "device" or path[1] not in self.handler.state._devices:
			raise Exception("not authorized")
		device = self.handler.state._devices[path[1]]
		if path[2] != device.authToken:
			raise Exception("not authorized")

		if request == "DESCRIBE":
			sdp = """v=0
o=- 0 0 IN IP4 0.0.0.0
s=unnamed
c=IN IPV4 0.0.0.0
t=0 0
a=recvonly
m=audio 0 RTP/AVP 14
a=rtpmap:14 mpa/90000/2
"""
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\nContent-Type: application/sdp\r\nContent-Length: %d\r\n\r\n" % (data["cseq"], len(sdp)) + sdp
			self.sock.send(response)
		elif request == "SETUP":
			transport = data["transport"].split(";")
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
			rtpAddr = (self.addr[0], plo) + self.addr[2:]
			session = self.handler.state.createSession(rtpAddr)
			tsp = data["transport"] + ";server_port=" + self.handler.server_port
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: %s;timeout=60\r\nTransport: %s\r\n\r\n" % (data["cseq"], session.id, tsp)
			self.sock.send(response)
		elif request == "PLAY":
			sessionId = data["session"]
			session = self.handler.state._sessions[sessionId]
			media = self.handler.state.createMediaStream(session, device)
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: %s\r\n\r\n" % (data["cseq"], session.id)
			self.sock.send(response)
		elif request == "TEARDOWN":
			sessionId = data["session"]
			session = self.handler.state._sessions[sessionId]
			session.discard(self.handler.state)
			response = "RTSP/1.0 200 OK\r\nCSeq: %s\r\n" % (data["cseq"])
		else:
			raise ValueError("unsupported request: %s" % (request,))

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
			return self.close()
		if events != select.EPOLLIN:
			raise Exception(events)
		n = self.sock.recv_into(self.view[self.write:])
		if not n:
			# HUP?
			self.reactor.unregister(self.sock.fileno())
			self.sock.close() # ???
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
	def __init__(self, addr, db, userDb, reactor):
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

		self.state = State(userDb, db, self.rtp, reactor)
		try:
			d = self.state.createDevice("test")
		except KeyError:
			d = self.state.getDevice("test")
		try:
			a = self.state.createAggregate("test")
		except KeyError:
			a = self.state.getAggregate("test")
		self.state.setDeviceAggregate(d, "test")
		try:
			c = self.state.createChannel("test")
		except KeyError:
			c = self.state.getChannel("test")
		self.state.setAggregateChannel(a, "test")
		print d.name, d.authToken
		u = self.state.getUser("el")
		self.state.setUserAggregate(u, "test")

		self.reactor = reactor
		self.reactor.register(self.sock.fileno(), select.EPOLLIN, self._connection)
		self.reactor.register(self.rtcp.fileno(), select.EPOLLIN, self._onRtcp)

		self.sessions = {}

	HDR = struct.Struct("!BBH")
	RR = struct.Struct("!I")
	RR_block = struct.Struct("!IIIIII")

	def parse_RR(self, data, ofs, length, rc):
		ofs0 = ofs
		sender_ssrc, = self.RR.unpack_from(data, ofs)
		ofs += 4
		for i in xrange(rc):
			ssrc, loss, last, jitter, lsr, dlsr = self.RR_block.unpack_from(data, ofs)
			mediaStream = self.state._mediaStreams.get(ssrc)
			if mediaStream is not None:
				mediaStream.refresh(self.state) #update(sender_ssrc, loss, last, jitter, lsr, dlsr)
				mediaStream.session.refresh(self.state)
			print "sender_ssrc=%s, ssrc=%s, loss=%d, last=%d, jitter=%d, lsr=%d, dlsr=%d" % (sender_ssrc, ssrc, loss, last, jitter, lsr, dlsr)
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
			if e.errno == errno.EAGAIN:
				return
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
		Connection(addr, sock, self.reactor, self)


def test():
	import couchdb
	from reactor import Reactor

	_db = couchdb.Server("http://admin:secret@localhost:5984/")
	db = _db["imes"]
	userDb = _db["_users"]

	reactor = Reactor()
	handler = RTSPHandler(("0.0.0.0", 9997), db, userDb, reactor)
	try:
		reactor.run()
	except KeyboardInterrupt:
		pass


if __name__ == '__main__':
	test()
