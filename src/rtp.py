import time
import socket
import random
import struct
import heapq
import collections
import errno
import select
import urlparse
import json

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
		self.queue = []

	def close(self):
		self.reactor.unregister(self.sock.fileno())
		self.sock.close()

	def _complete(self):
		print repr(self.firstLine), self.data
		if not self.firstLine:
			self.close()

		try:
			request, uri, version = self.firstLine.split(None, 2)
		except ValueError:
			self.close()
			return
		self.queue.append((request, uri, version, self.data))
		self.firstLine = None
		self.data = {}

		if len(self.queue) == 1:
			self._processNext()

	def _processNext(self):
		request, uri, version, data = self.queue[0]

		p = urlparse.urlparse(uri)
		path = p.path.strip("/").split("/")

		def callback(response):
			if isinstance(response, Exception):
				self.sock.send(version + " 500 Internal Server Error\r\n\r\n" + str(e) + "\r\n")
				self.close()
			else:
				self.sock.send(response)
				self.queue.pop(0)
				if self.queue:
					self.reactor.defer(self._processNext)

		try:
			if version.startswith("RTSP/"):
				if version != "RTSP/1.0":
					self.close()
					return
				response = self._doRtsp(request, uri, path, data, callback)

			elif version.startswith("HTTP/"):
				if version != "HTTP/1.0" and version != "HTTP/1.1":
					self.close()
					return
				response = self._doHttp(request, uri, path, data, callback)

			else:
				self.close()
				return

		except Exception as e:
			logException()
			callback(e)
			return

		if response is not None:
			callback(response)
			return

	def _doHttpUser(self, request, uri, data, user, cmd, args, callback):
		def ok(response, ctype="application/json"):
			return "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: %s\r\nContent-Length: %d\r\nContent-Type: %s\r\n\r\n%s\r\n" % (self.handler.dbHost, len(response), ctype, response)

		if cmd == "channels":
			if args:
				raise ValueError()
			return ok(json.dumps(self.handler.state.listChannels))
		elif cmd == "status":
			if args:
				raise ValueError(repr(args))
			def cb(value):
				callback(ok(json.dumps(value)))
			self.handler.state.getUserStatus(user, cb)
			return
		else:
			raise ValueError()

	def _doHttpDelegate(self, request, uri, data, delegate, cmd, args, callback):
		if cmd == "pause":
			if not args:
				timeout = None
			elif len(args) == 1:
				timeout = int(args[0])
				if not 0 < timeout < 3600:
					raise ValueError()
			else:
				raise ValueError()
			self.handler.state.setDelegatePaused(delegate, True, timeout)
			return "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"
		elif cmd == "unpause":
			if args:
				raise ValueError()
			self.handler.state.setDelegatePaused(delegate, False)
			return "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"
		else:
			raise Exception("not authorized")

	def _doHttp(self, request, uri, path, data, callback):
		if request not in ("GET",):
			raise Exception("not authorized")
		if len(path) < 4:
			raise Exception("not authorized")
		if path[0] == "delegate":
			target = self.handler.state.getDelegate(path[1])
			p = self._doHttpDelegate
		elif path[0] == "user":
			target = self.handler.state.getUser(path[1])
			p = self._doHttpUser
		else:
			raise Exception("not authorized")
		if path[2] != target.authToken:
			raise Exception("not authorized")
		return p(request, uri, data, target, path[3], path[4:], callback)

	def _doRtsp(self, request, uri, path, data, callback):
		if request == "OPTIONS":
			return "RTSP/1.0 200 OK\r\nCSeq: %s\r\nPublic: DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE\r\n\r\n" % data["cseq"]

		if len(path) < 3 or path[0] != "device" or path[1] not in self.handler.state._devices:
			raise Exception("not authorized")
		device = self.handler.state.getDevice(path[1])
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
			return "RTSP/1.0 200 OK\r\nCSeq: %s\r\nContent-Type: application/sdp\r\nContent-Length: %d\r\n\r\n" % (data["cseq"], len(sdp)) + sdp
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
			return "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: %s;timeout=60\r\nTransport: %s\r\n\r\n" % (data["cseq"], session.id, tsp)
		elif request == "PLAY":
			sessionId = data["session"]
			session = self.handler.state._sessions[sessionId]
			media = self.handler.state.createMediaStream(session, device)
			return "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: %s\r\n\r\n" % (data["cseq"], session.id)
		elif request == "TEARDOWN":
			sessionId = data["session"]
			session = self.handler.state._sessions[sessionId]
			session.discard(self.handler.state)
			return "RTSP/1.0 200 OK\r\nCSeq: %s\r\n" % (data["cseq"])
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
		if self.write >= len(self.buf):
			print "buffer overflow"
			self.close()
			return
		p = self.buf.find("\r\n", self.read)
		while self.read <= p < self.write:
			self._processLine(self.view[self.read : p].tobytes())
			self.read = p + 2
			p = self.buf.find("\r\n", self.read)
		if self.read:
			self.view[0 : self.write - self.read] = self.view[self.read : self.write]
			self.write -= self.read
			self.read = 0
		#print repr(self.buf)



class RTSPHandler(object):
	def __init__(self, addr, db, userDb, reactor):
		self.dbHost = "http://localhost:5984"
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
		print "device/%s/%s" % (d.name, d.authToken)
		u = self.state.getUser("el")
		self.state.setUserAggregate(u, "test")
		try:
			de = self.state.createDelegate("test")
		except KeyError:
			de = self.state.getDelegate("test")
		self.state.setDelegateDevices(de, ["test"])
		print "delegate/%s/%s" % (de.name, de.authToken)

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
