import fcntl
import os
import struct
import marshal
import select
import collections
import errno

HDR = struct.Struct("II")

class MethodProxy(object):
	def __init__(self, proxy, method):
		self.proxy = proxy
		self.method = method

	def __call__(self, *args, **kw):
		return self.proxy._rpc(self.method, *args, **kw)

class Proxy(object):
	def __getattr__(self, name):
		return MethodProxy(self, name)

	def __del__(self):
		if self._read_fd is not None:
			os.close(self._read_fd)
		os.close(self._write_fd)

class Sync(Proxy):
	def __init__(self, commandMap, read_fd, write_fd):
		self.commandMap = commandMap
		self._read_fd = read_fd
		self._write_fd = write_fd
		self._id = 0
		self._outstanding = {}

	def _rpc(self, command, *args, **kwargs):
		callback = kwargs.pop("callback", None)
		if callback is None:
			i = 0
		else:
			i = self._id = self._id + 1
			if i == 0x80000000:
				i = self._id = 1
			self._outstanding[i] = callback
		data = marshal.dumps((command, args, kwargs))
		hdr = HDR.pack(i, len(data))
		self._send_all(hdr + data)

	def _send_all(self, data):
		while True:
			n = os.write(self._write_fd, data)
			if not n:
				print "IPC problem; unexpected EOF (w/s)"
				raise SystemExit()
			if n == len(data):
				return
			data = memoryview(data, n)

	def run(self):
		buf = ""
		while True:
			data = os.read(self._read_fd, 4096)
			if not data:
				print "IPC problem; unexpected EOF (r/s)"
				raise SystemExit()
			buf += data
			if len(buf) < 8:
				continue
			i, l = HDR.unpack_from(buf)
			if len(buf) < 8 + l:
				continue
			data = buf[8 : 8 + l]
			buf = buf[8 + l:]
			if i & 0x80000000:
				response = marshal.loads(data)
				self._outstanding.pop(i & 0x7FFFFFFF)(response)
			else:
				cmd, args, kw = marshal.loads(data)
				result = self.commandMap[cmd](*args, **kw)
				if i:
					rdata = marshal.dumps(result)
					hdr = HDR.pack(i | 0x80000000, len(rdata))
					self._send_all(hdr + rdata)

class Async(Proxy):
	def __init__(self, commandMap, read_fd, write_fd, reactor):
		self.commandMap = commandMap
		self._read_fd = read_fd
		self._write_fd = write_fd
		fcntl.fcntl(self._read_fd, fcntl.F_SETFL, fcntl.fcntl(self._read_fd, fcntl.F_GETFL) | os.O_NONBLOCK)
		fcntl.fcntl(self._write_fd, fcntl.F_SETFL, fcntl.fcntl(self._write_fd, fcntl.F_GETFL) | os.O_NONBLOCK)
		self._id = 0
		self._outstanding = {}
		self._queue = collections.deque()
		self.reactor = reactor
		self.reactor.register(self._read_fd, select.EPOLLIN, self._read)
		self._writeBlocked = False
		self._temp = b""
		self.essential = False

	def stop(self):
		if self._read_fd is not None:
			self.reactor.unregister(self._read_fd)
			self._read_fd = None
		if self.essential:
			self.reactor.stop()
			self.essential = False

	def _rpc(self, command, *args, **kwargs):
		callback = kwargs.pop("callback", None)
		if callback is None:
			i = 0
		else:
			i = self._id = self._id + 1
			if i == 0x80000000:
				i = self._id = 1
			self._outstanding[i] = callback
		data = marshal.dumps((command, args, kwargs))
		hdr = HDR.pack(i, len(data))
		self._queue.append(hdr)
		self._queue.append(data)
		if not self._writeBlocked:
			self._write(select.EPOLLOUT)

	def _write(self, event):
		if event != select.EPOLLOUT:
			self._writeBlocked = False
			print "IPC problem (w):", event
			self.reactor.unregister(self._write_fd)
			return
		assert self._queue
		while self._queue:
			try:
				n = os.write(self._write_fd, self._queue[0])
				if not n:
					print "IPC problem; unexpected EOF (w)"
					self._writeBlocked = True
					#if not self._writeBlocked:
					#	self._writeBlocked = True
					#	self.reactor.register(self._write_fd, select.EPOLLOUT, self._write)
					return
			except OSError as e:
				if e.errno == errno.EAGAIN:
					if not self._writeBlocked:
						self._writeBlocked = True
						self.reactor.register(self._write_fd, select.EPOLLOUT, self._write)
					return
				raise
			assert n > 0
			if n == len(self._queue[0]):
				self._queue.popleft()
			else:
				self._queue[0] = memoryview(self._queue[0])[n:]
		if self._writeBlocked:
			self.reactor.unregister(self._write_fd)

	def _call(self, i, cmd, args, kw):
		if i:
			def cb(result):
				rdata = marshal.dumps(result)
				hdr = HDR.pack(i | 0x80000000, len(rdata))
				self._queue.append(hdr)
				self._queue.append(rdata)
				if not self._writeBlocked:
					self._write(select.EPOLLOUT)
			kw["callback"] = cb
		self.commandMap[cmd](*args, **kw)

	def _read(self, event):
		if event != select.EPOLLIN:
			print "IPC problem (r):", event
			self.stop()
			return
		while True:
			try:
				data = os.read(self._read_fd, 4096)
				if not data:
					print "IPC problem; unexpected EOF (r)", event
					self.stop()
					return
			except OSError as e:
				if e.errno == errno.EAGAIN:
					return
			self._temp += data
			while len(self._temp) >= 8:
				i, l = HDR.unpack_from(self._temp)
				if len(self._temp) < 8 + l:
					break
				data = self._temp[8 : 8 + l]
				self._temp = self._temp[8 + l:]
				if i & 0x80000000:
					response = marshal.loads(data)
					self._outstanding.pop(i & 0x7FFFFFFF)(response)
				else:
					cmd, args, kw = marshal.loads(data)
					self._call(i, cmd, args, kw)

def slave(reactor, r, w):
	def bye():
		print "master says bye"
		raise SystemExit()

	def do(a, b):
		print "doing something"
		return a + b

	def fast(a, b):
		return a + b

	proxy = Sync({
		"bye": bye,
		"do": do,
		"fast": fast,
	}, r, w)
	proxy.run()
	print "client: bye"

def master(reactor, r, w):
	proxy = Async({
	}, r, w, reactor)
	def work2():
		t0 = clock()
		def r(r):
			print clock()-t0, r
		proxy.fast(7, 9, callback=r)
		reactor.schedule(clock() + 0.01, work)
	def work():
		t0 = clock()
		def r(r):
			print clock()-t0, r
		proxy.do(7, 9, callback=r)
		reactor.schedule(clock() + 0.01, work2)
	reactor.schedule(clock() + 1, work)
	try:
		reactor.run()
	except KeyboardInterrupt:
		proxy.bye()
		reactor.run()

if __name__ == '__main__':
	from reactor import Reactor, clock
	reactor = Reactor()
	m2s_r, m2s_w = os.pipe()
	s2m_r, s2m_w = os.pipe()
	pid = os.fork()
	if not pid:
		os.close(m2s_w)
		os.close(s2m_r)
		slave(reactor, m2s_r, s2m_w)
	else:
		os.close(m2s_r)
		os.close(s2m_w)
		master(reactor, s2m_r, m2s_w)
