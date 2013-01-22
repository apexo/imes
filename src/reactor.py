import select
import heapq
import time
import errno

#clock = getattr(time, "monotonic", time.time)
clock = time.time
_never = clock() + 365.2425*86400*100

class Reactor(object):
	def __init__(self):
		self.deferred = []
		self.scheduled = []
		self.poll = select.epoll()
		self.events = {}
		self.monotonicClocks = set()

	def defer(self, task, *args, **kw):
		self.deferred.append((task, args, kw))

	def scheduleReal(self, t, task, *args, **kw):
		heapq.heappush(self.scheduled, (t, 0, task, args, kw))

	def scheduleMonotonic(self, t, task, *args, **kw):
		heapq.heappush(self.scheduled, (t, 1, task, args, kw))

	def register(self, fd, events, cb, *args, **kw):
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

	def run(self):
		t0 = clock()
		t1 = _never
		while True:
			t = clock()
			if t < t0 - 0.1:
				self.adjustMonotonicClocks(t - t0)
			elif t > t1 + 0.5:
				self.adjustMonotonicClocks(t - t1)
			while self.scheduled and self.scheduled[0][0] <= t:
				item = heapq.heappop(self.scheduled)
				item[2](t, *item[3], **item[4])
			if self.deferred:
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
			try:
				for fd, events in self.poll.poll(*timeout):
					e = self.events.get(fd)
					if e is not None:
						e[0](events, *e[1], **e[2])
			except IOError as e:
				if e.errno != errno.EINTR:
					raise
