import select
import heapq
import time
import errno
import signal
import os
import fcntl

#clock = getattr(time, "monotonic", time.time)
clock = time.time
_never = clock() + 365.2425*86400*100

class Reactor(object):
	def __init__(self):
		self.deferred = []
		self.deferredIdle = []
		self.scheduled = []
		self.poll = select.epoll()
		self.events = {}
		self.monotonicClocks = set()
		self.pids = {}
		self._running = True

	def defer(self, task, *args, **kw):
		self.deferred.append((task, args, kw))

	def deferIdle(self, task, *args, **kw):
		self.deferredIdle.append((task, args, kw))

	def scheduleReal(self, t, task, *args, **kw):
		heapq.heappush(self.scheduled, (t, 0, task, args, kw))

	def scheduleMonotonic(self, t, task, *args, **kw):
		heapq.heappush(self.scheduled, (t, 1, task, args, kw))

	def register(self, fd, events, cb, *args, **kw):
		fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)

		self.events[fd] = cb, args, kw
		self.poll.register(fd, events)

	def unregister(self, fd):
		self.poll.unregister(fd)
		self.events.pop(fd, None)

	def registerMonotonicClock(self, clock):
		self.monotonicClocks.add(clock)

	def unregisterMonotonicClock(self, clock):
		self.monotonicClocks.discard(clock)

	def adjustMonotonicClocks(self, dt):
		for clock in self.monotonicClocks:
			clock.adjust(dt)
		scheduled = []
		for t, monotonic, task, args, kw in self.scheduled:
			heapq.heappush(scheduled, (t + dt if monotonic else t, monotonic, task, args, kw))
		self.scheduled = scheduled

	def registerPid(self, pid, callback):
		if not self.pids:
			signal.signal(signal.SIGCHLD, self._childExited)
		self.pids[pid] = callback

	def _childExited(self, signo=None, frame=None):
		while True:
			try:
				pid, status = os.waitpid(-1, os.WNOHANG)
				if not pid:
					return
				cb = self.pids.pop(pid, None)
				if cb is None:
					print "UNHANDLED CHILD EXIT: %d %d", pid, status, "from pid", os.getpid()
				else:
					cb(pid, status)
			except OSError as e:
				if e.errno != errno.ECHILD:
					raise
				return

	def _stop(self, signo, frame):
		self._running = False

	def stop(self):
		def shutdown():
			raise SystemExit()
		self.defer(shutdown)

	def run(self):
		t0 = clock()
		t1 = _never
		oldInt = signal.signal(signal.SIGINT, self._stop)
		oldTerm = signal.signal(signal.SIGTERM, self._stop)

		while self._running:
			idle = True
			t = clock()
			if t < t0 - 0.1:
				self.adjustMonotonicClocks(t - t0)
			elif t > t1 + 0.5:
				self.adjustMonotonicClocks(t - t1)
			while self.scheduled and self.scheduled[0][0] <= t:
				idle = False
				item = heapq.heappop(self.scheduled)
				item[2](t, *item[3], **item[4])
			if self.deferred:
				idle = False
				item = self.deferred.pop(0)
				item[0](*item[1], **item[2])
				continue
			if not self.scheduled:
				if not self.events:
					break
				t1 = _never
				timeout = ()
			else:
				t1 = self.scheduled[0][0]
				timeout = t1 - t,
			if self.deferredIdle:
				timeout = 0,
			try:
				for fd, events in self.poll.poll(*timeout):
					idle = False
					e = self.events.get(fd)
					if e is not None:
						e[0](events, *e[1], **e[2])
			except IOError as e:
				if e.errno != errno.EINTR:
					raise
			if idle and self.deferredIdle:
				item = self.deferredIdle.pop(0)
				item[0](*item[1], **item[2])

		signal.signal(signal.SIGINT, oldInt)
		signal.signal(signal.SIGTERM, oldTerm)
