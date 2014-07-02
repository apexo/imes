import socket
import struct
import errno
import select
import urlparse
import json
import traceback

from src.state import State

class FixedLengthBodyDecoder(object):
	def __init__(self, length):
		self.length = length
		self.value = ""
		self.remaining = length

	def feed(self, data, ofs, length):
		n = min(length, self.remaining)
		self.value += data[ofs:ofs+n].tobytes()
		self.remaining -= n
		return n, not self.remaining

CORS_ORIGIN = "Access-Control-Allow-Origin"
CORS_METHODS = "Access-Control-Allow-Methods"
CORS_HEADERS = "Access-Control-Allow-Headers"
CORS_MAXAGE = "Access-Control-Max-Age"
CTYPE = "Content-Type"
MAXAGE = 3600

class Response(object):
	def __init__(self, version):
		self.headers = {}
		self.version = version
		self.code = 200
		self.msg = "OK"
		self.body = None

	def addHeader(self, name, value):
		if name in self.headers:
			self.headers[name] += ","+value
		else:
			self.headers[name] = value

	def setHeader(self, name, value):
		self.headers[name] = value

	def allowOrigin(self, *origins):
		for origin in origins:
			self.addHeader(CORS_ORIGIN, origin)

	def allowMethod(self, *methods):
		for method in methods:
			self.addHeader(CORS_METHODS, method)

	def allowHeader(self, *headers):
		for header in headers:
			self.addHeader(CORS_HEADERS, header)

	def setResponse(self, code, msg):
		self.code = code
		self.msg = msg

	def setBody(self, body):
		if body is not None:
			self.setHeader("Content-Length", len(body))
		else:
			self.headers.pop("Content-Length", None)
		self.body = body

	def assemble(self):
		result = "%s %d %s\r\n" % (self.version, self.code, self.msg)
		for hdr, value in self.headers.iteritems():
			result += "%s: %s\r\n" % (hdr, value)
		result += "\r\n"
		if self.body is not None:
			result += self.body
		return result

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
		self.body = None

	def close(self):
		if self.sock is None:
			return
		self.reactor.unregister(self.sock.fileno())
		self.sock.close()
		self.sock = None

	def _bodyDecoder(self, data):
		if "content-length" in data:
			return FixedLengthBodyDecoder(int(data["content-length"]))
		raise ValueError()

	def _complete(self):
		if not self.firstLine:
			self.close()

		try:
			request, uri, version = self.firstLine.split(None, 2)
		except ValueError:
			self.close()
			return
		if self.body is None:
			if request in ("POST", "PUT") or request in ("DELETE", "OPTIONS") and "transfer-encoding" in self.data or "content-length" in self.data:
				self.body = self._bodyDecoder(self.data)
				return
		self.queue.append((request, uri, version, self.data, None if self.body is None else self.body.value))
		self.firstLine = None
		self.data = {}
		self.body = None

		if len(self.queue) == 1:
			self._processNext()

	def _processNext(self):
		request, uri, version, data, body = self.queue[0]

		p = urlparse.urlparse(uri)
		path = p.path.strip("/").split("/")
		query = urlparse.parse_qs(p.query) if p.query else {}

		def callback(response):
			if self.sock is None:
				return
			if isinstance(response, Response):
				doClose = response.headers.get("Connection") == "close"
				response = response.assemble()
			else:
				doClose = False
			if isinstance(response, Exception):
				resp = Response("HTTP/1.1")
				resp.setResponse(500, "Internal Server Error")
				resp.setHeader(CTYPE, "text/plain")
				resp.setHeader("Connection", "close")
				resp.setBody(str(response))
				self.sock.send(resp.assemble())
				doClose = True
				self.close()
			else:
				self.sock.send(response)
				self.queue.pop(0)
				if data.get("connection") == "close" or doClose:
					self.close()
				elif self.queue:
					self.reactor.defer(self._processNext)

		try:
			if version.startswith("RTSP/"):
				if version != "RTSP/1.0":
					self.close()
					return
				response = self._doRtsp(request, uri, path, data, body, callback)

			elif version.startswith("HTTP/"):
				if version != "HTTP/1.0" and version != "HTTP/1.1":
					self.close()
					return
				response = self._doHttp(request, uri, path, data, body, callback, query)
			else:
				self.close()
				return

		except Exception as e:
			traceback.print_exc();
			callback(e)
			return

		if response is not None:
			callback(response)
			return

	def _makeResponse(self, value=None, methods=(), is_options=False):
		r = Response("HTTP/1.1")
		r.allowOrigin(self.handler.dbHost)
		r.allowMethod(*methods)
		if "POST" in methods or "PUT" in methods:
			r.allowHeader(CTYPE)
		if is_options:
			r.setHeader(CORS_MAXAGE, MAXAGE)
			r.setHeader(CTYPE, "text/plain")
			r.setHeader("Cache-Control", "max-age=864000")
			r.setBody("")
		else:
			r.setHeader(CTYPE, "application/json")
			r.setBody(json.dumps(value))
			r.setHeader("Cache-Control", "no-cache")
		return r

	def _httpModel(self, request, uri, data, body, user, cmd, args, callback, create, delete, list_, get, transform):
		if request == "GET":
			if not args:
				return self._makeResponse(list_(), methods=("PUT", "DELETE", "POST"))
			elif len(args) == 1:
				return self._makeResponse(transform(get(args[0])), methods=("PUT", "DELETE", "POST"))
			else:
				raise Exception("not authorized")
		elif request == "PUT":
			if len(args) == 1:
				create(args[0])
				return self._makeResponse({}, methods=("PUT", "DELETE", "POST"))
			else:
				raise Exception("not authorized")
		elif request == "DELETE":
			if len(args) == 1:
				delete(args[0])
				return self._makeResponse({}, methods=("PUT", "DELETE", "POST"))
			else:
				raise Exception("not authorized")
		elif request == "OPTIONS":
			if len(args) == 1:
				return self._makeResponse(methods=("PUT", "DELETE", "POST"), is_options=True)
			else:
				raise Exception("not authorized")
		else:
			raise Exception("not authorized")

	def _doHttpUser(self, request, uri, data, body, user, cmd, args, callback, query):
		state = self.handler.state
		scrobbler = self.handler.scrobbler

		if query and cmd != "status":
			raise Exception("not authorized")

		if cmd == "status":
			if set(query) - set(["channel"]) or len(query.get("channel", [])) > 1:
				raise Exception("not authorized")
			if args:
				raise Exception("not authorized")
			def cb(value):
				callback(self._makeResponse(value, methods=("POST",)))
			if request == "OPTIONS":
				return self._makeResponse(methods=("POST",), is_options=True)
			elif request == "GET":
				self.handler.state.getUserStatus(user, cb, query.get("channel", [None])[0])
			elif request == "POST":
				data = json.loads(body)
				if "aggregate" in data:
					state.setUserAggregate(user, data["aggregate"])
				if "channel" in data:
					state.setAggregateChannel(user.aggregate, data["channel"])
				if "session_timeout" in data:
					user.setSessionTimeout(data["session_timeout"], state)
				if "lockout" in data:
					user.setLockout(data["lockout"], state)
				self.handler.state.getUserStatus(user, cb)
			else:
				raise Exception("not authorized")
		elif cmd == "play":
			if args:
				raise Exception("not authorized")
			if request == "OPTIONS":
				return self._makeResponse(methods=("POST",), is_options=True)
			elif request == "POST":
				data = json.loads(body)
				self.handler.state.play(user, data["plid"], data["idx"], data["fid"])
				return self._makeResponse({}, methods=("POST",))
			else:
				raise Exception("not authorized")
		elif cmd == "channel":
			if len(args) == 1 and request == "POST":
				data = json.loads(body)
				if "paused" in data:
					state.setChannelPaused(state.getChannel(args[0]), data["paused"])
				return self._makeResponse({}, methods=("PUT", "DELETE", "POST"))
			return self._httpModel(request, uri, data, body, user, cmd, args, callback,
				state.createChannel, state.deleteChannel, state.listChannels, state.getChannel,
				lambda channel: {
					"aggregates": sorted([aggregate.name for aggregate in channel.aggregates])
				}
			)
		elif cmd == "device":
			if len(args) == 1 and request == "POST":
				data = json.loads(body)
				if "aggregate" in data:
					state.setDeviceAggregate(state.getDevice(args[0]), data["aggregate"])
				return self._makeResponse({}, methods=("PUT", "DELETE", "POST"))
			return self._httpModel(request, uri, data, body, user, cmd, args, callback,
				state.createDevice, state.deleteDevice, state.listDevices, state.getDevice,
				lambda device: {
					"authToken": device.authToken,
					"aggregate": None if device.aggregate is None else device.aggregate.name,
					"delegates": sorted([delegate.name for delegate in device.delegates]),
				}
			)
		elif cmd == "delegate":
			if len(args) == 1 and request == "POST":
				data = json.loads(body)
				if "devices" in data:
					state.setDelegateDevices(state.getDelegate(args[0]), data["devices"])
				return self._makeResponse({}, methods=("PUT", "DELETE", "POST"))
			return self._httpModel(request, uri, data, body, user, cmd, args, callback,
				state.createDelegate, state.deleteDelegate, state.listDelegates, state.getDelegate,
				lambda delegate: {
					"authToken": delegate.authToken,
					"devices": sorted([device.name for device in delegate.devices]),
					"paused": delegate.paused,
				}
			)
		elif cmd == "aggregate":
			if len(args) == 1 and request == "POST":
				data = json.loads(body)
				if "channel" in data:
					state.setAggregateChannel(state.getAggregate(args[0]), data["channel"])
				return self._makeResponse({}, methods=("PUT", "DELETE", "POST"))
			return self._httpModel(request, uri, data, body, user, cmd, args, callback,
				state.createAggregate, state.deleteAggregate, state.listAggregates, state.getAggregate,
				lambda aggregate: {
					"devices": sorted([device.name for device in aggregate.devices]),
					"users": sorted([user.name for user in aggregate.users]),
					"channel": "" if aggregate.channel is None else aggregate.channel.name,
				}
			)
		elif cmd == "scrobbler":
			if request == "OPTIONS":
				return self._makeResponse(methods=("POST",), is_options=True)
			if not args and request == "GET":
				return self._makeResponse(scrobbler.getNetworks(user.name), methods=("POST",))
			elif len(args) == 2 and request == "POST":
				if args[0] in scrobbler.getNetworks(user.name):
					if args[1] == "auth":
						return self._makeResponse(scrobbler.getWebAuthUrl(user.name, args[0]), methods=("POST",))
					elif args[1] == "validate":
						return self._makeResponse(scrobbler.verifyNetworkConfiguration(user.name, args[0]), methods=("POST",))
					elif args[1] == "remove":
						return self._makeResponse(scrobbler.removeNetworkConfiguration(user.name, args[0]), methods=("POST",))
			raise Exception("not authorized")
		else:
			raise ValueError()

	def _doHttpDelegate(self, request, uri, data, body, delegate, cmd, args, callback, query):
		if request != "GET" or query:
			raise Exception("not authorized")
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

	def _doHttpDevice(self, request, uri, data, body, device, cmd, args, callback, query):
		if request != "GET" or cmd != "stream.mp3" or args or query:
			raise Exception("not authorized")
		response = Response("HTTP/1.1")
		response.setHeader("Content-Type", "audio/mpeg") # TODO: correct?
		response.setHeader("Connection", "close")
		self.reactor.unregister(self.sock.fileno())
		self.sock.send(response.assemble())
		self.sock.shutdown(socket.SHUT_RD)
		self.handler.state.addDeviceHttpStream(device, self.sock)

	def _doHttp(self, request, uri, path, data, body, callback, query):
		if request not in ("GET", "POST", "OPTIONS", "PUT", "DELETE"):
			raise Exception("not authorized")
		if len(path) < 4:
			raise Exception("not authorized")
		if path[0] == "delegate":
			target = self.handler.state.getDelegate(path[1])
			p = self._doHttpDelegate
		elif path[0] == "user":
			target = self.handler.state.getUser(path[1])
			if not target.authorized:
				raise Exception("not authorized")
			p = self._doHttpUser
		elif path[0] == "device":
			target = self.handler.state.getDevice(path[1])
			p = self._doHttpDevice
		else:
			raise Exception("not authorized")
		if path[2] != target.authToken:
			raise Exception("not authorized")
		return p(request, uri, data, body, target, path[3], path[4:], callback, query)

	def _doRtsp(self, request, uri, path, data, body, callback):
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
			self.handler.state.createMediaStream(session, device)
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
			return self._complete()
		if self.firstLine is None:
			self.firstLine = line
			return
		hdr, sep, value = line.partition(":")
		if not sep:
			raise ValueError(line)
		self.data[hdr.lower().strip()] = value.strip()

	def _process(self, events):
		if events & select.EPOLLHUP:
			return self.close()
		if events != select.EPOLLIN:
			raise Exception(events)
		try:
			n = self.sock.recv_into(self.view[self.write:])
		except socket.error as e:
			if e.errno == errno.EAGAIN:
				return
			raise
		if not n:
			# HUP?
			self.close()
			return
		self.write += n
		if self.write >= len(self.buf):
			print "buffer overflow"
			self.close()
			return
		while True:
			if self.body is not None:
				while True:
					n, done = self.body.feed(self.view, self.read, self.write-self.read)
					if done:
						self.read += n
						self._complete()
						break
					assert n > 0
					self.read += n
					if self.read == self.write:
						self.read = self.write = 0
						return
			p = self.buf.find("\r\n", self.read)
			while self.body is None and self.read <= p < self.write:
				try:
					self._processLine(self.view[self.read : p].tobytes())
				except ValueError:
					self.close()
					return
				self.read = p + 2
				p = self.buf.find("\r\n", self.read)
			if self.body is not None:
				continue
			if self.read:
				self.view[0 : self.write - self.read] = self.view[self.read : self.write]
				self.write -= self.read
				self.read = 0
			break
			#print repr(self.buf)



class RTSPHandler(object):
	def __init__(self, addr, rtpPort, dbHost, db, userDb, reactor, scrobbler):
		self.dbHost = dbHost
		self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
		self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
		self.sock.bind(addr)
		self.sock.listen(4)

		sn_rtp = (addr[0], rtpPort) + addr[2:]

		self.rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
		self.rtp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
		self.rtp.bind(sn_rtp)

		sn_rtp = sn_rtp if rtpPort else self.rtp.getsockname()

		self.rtcp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
		self.rtcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
		self.rtcp.bind((sn_rtp[0], sn_rtp[1] + 1) + sn_rtp[2:])

		self.server_port = "%d-%d" % (sn_rtp[1], sn_rtp[1] + 1)

		self.state = State(userDb, db, self.rtp, reactor, scrobbler)

		self.reactor = reactor
		self.reactor.register(self.sock.fileno(), select.EPOLLIN, self._connection)
		self.reactor.register(self.rtcp.fileno(), select.EPOLLIN, self._onRtcp)

		self.sessions = {}

		self.scrobbler = scrobbler

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
		try:
			sock, addr = self.sock.accept()
		except socket.error as e:
			if e.errno == errno.EAGAIN:
				return
			raise
		Connection(addr, sock, self.reactor, self)
