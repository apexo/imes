import inotifyx
import os
import stat
import heapq
import pprint
import errno
import base64

WATCH_FLAGS = (
	inotifyx.IN_CLOSE_WRITE |
	inotifyx.IN_ATTRIB |
	inotifyx.IN_CREATE |
	inotifyx.IN_DELETE |
	inotifyx.IN_DONT_FOLLOW |
	inotifyx.IN_ONLYDIR |
	inotifyx.IN_MOVED_FROM |
	inotifyx.IN_MOVED_TO |
0)

def _id(d):
	return base64.urlsafe_b64encode(d)[:(len(d)*8+5) // 6]

class Task(object):
	def __lt__(self, o):
		return self.priority < o.priority

class ProcessEvents(Task):
	__slots__ = ["events"]

	priority = -1

	def __init__(self, events):
		self.events = events

	def run(self, monitor):
		monitor.processEvents(self.events)

class ScanFile(Task):
	__slots__ = ['path']

	priority = 1

	def __init__(self, path):
		self.path = path

	def run(self, monitor):
		monitor.add(self.path)

class ScanDir(Task):
	__slots__ = ['watch']

	priority = 2

	def __init__(self, watch):
		self.watch = watch

	def run(self, monitor):
		p = self.watch.path

		for item in os.listdir(p):
			s = os.lstat(os.path.join(p, item))
			if stat.S_ISDIR(s.st_mode):
				monitor._watchPath(self.watch, item)
			elif stat.S_ISREG(s.st_mode):
				monitor.enqueue(ScanFile(os.path.join(p, item)))

class ScanCleanup(Task):
	__slots__ = ['root']

	priority = 3

	def run(self, monitor):
		monitor.cleanup()

class WatchBase(object):
	def __init__(self, monitor):
		self.children = None
		self.wd = inotifyx.add_watch(monitor.fd, self.path, self.watch_flags)
		monitor.wds[self.wd] = self
		monitor.enqueue(ScanDir(self))
		#print "#", self.path

	def addChild(self, name, child):
		if self.children is None:
			self.children = {}
		self.children[name] = child

	def removeChild(self, name):
		value = self.children.pop(name)
		if not self.children:
			self.children = None
		return value

	def _unwatch_down(self, monitor):
		try:
			inotifyx.rm_watch(monitor.fd, self.wd)
		except IOError as e:
			if e.errno != errno.EINVAL:
				raise
			# we ignore DELETE_SELF on non-roots, so unwatch() on DELETE may be too late
		monitor.wds.pop(self.wd)
		for child in (self.children or {}).itervalues():
			child._unwatch_down(monitor)
		self.children = None

	def unwatch(self, monitor):
		self._unwatch_up()
		self._unwatch_down(monitor)

class WatchRoot(WatchBase):
	__slots__ = ['monitor', 'path', 'wd', 'children']

	watch_flags = WATCH_FLAGS | inotifyx.IN_MOVE_SELF | inotifyx.IN_DELETE_SELF

	def __init__(self, monitor, path):
		self.monitor = monitor
		self.path = path
		super(WatchRoot, self).__init__(monitor)
		self.monitor.dirs[path] = self

	def _unwatch_up(self):
		self.monitor.dirs.pop(self.path)

class WatchedPath(WatchBase):
	__slots__ = ['parent', 'wd', 'name', 'children']

	watch_flags = WATCH_FLAGS

	def __init__(self, monitor, parent, name):
		self.parent = parent
		self.name = name
		super(WatchedPath, self).__init__(monitor)
		self.parent.addChild(name, self)

	def _unwatch_up(self):
		self.parent.removeChild(self.name)

	path = property(lambda self: os.path.join(self.parent.path, self.name))
	#monitor = property(lambda self: self.parent.monitor)

def tri_walk(d, p):
	assert p.startswith("/")
	for e in p[1:].split("/"):
		d = d.setdefault(e, {})
	return d

class Monitor(object):
	def __init__(self):
		super(Monitor, self).__init__()
		self.fd = inotifyx.init()
		self.dirs = {}
		self.wds = {}
		self.queue = []

	def addRoot(self, root):
		root = os.path.realpath(root)
		assert not root.endswith("/")
		if root in self.dirs:
			return
		WatchRoot(self, root)

	def deferCleanup(self):
		self.enqueue(ScanCleanup())

	def _move(self, srcwd, dstwd, mask, srcname, dstname):
		isDir = bool(mask & inotifyx.IN_ISDIR)

		src = os.path.join(self.wds[srcwd].path, srcname) if srcwd else None
		dst = os.path.join(self.wds[dstwd].path, dstname) if dstwd else None

		if srcwd and dstwd:
			self.move(src, dst, isDir)
			if isDir:
				node = self.wds[srcwd].removeChild(srcname)
				self.wds[dstwd].addChild(dstname, node)
				node.name = dstname
				node.parent = self.wds[dstwd]
		elif srcwd:
			self.remove(src, isDir)
			if isDir:
				self.wds[srcwd].children[srcname].unwatch(self)
		else:
			assert dstwd
			if isDir:
				self._watchPath(self.wds[dstwd], dstname)
			else:
				self.add(dst)

	def _move_self(self, wd, mask, name):
		root = self.wds[wd].path

		self.remove(root, True)
		self.wds[wd].unwatch(self)

		self.addRoot(root)

	def _attrib(self, wd, mask, name):
		if name is None:
			return
		isDir = mask & inotifyx.IN_ISDIR
		if isDir:
			self._watchPath(self.wds[wd], name)
		else:
			self.add(os.path.join(self.wds[wd].path, name))

	def _close_write(self, wd, mask, name):
		assert not mask & inotifyx.IN_ISDIR
		self.add(os.path.join(self.wds[wd].path, name))

	def _delete(self, wd, mask, name):
		isDir = bool(mask & inotifyx.IN_ISDIR)
		if isDir and name in (self.wds[wd].children or {}):
			self.wds[wd].children[name].unwatch(self)
		self.remove(os.path.join(self.wds[wd].path, name), isDir)

	def _delete_self(self, wd, mask, name):
		print "DELETE SELF", hex(mask), wd, name
		self.wds[wd].unwatch(self)

	def _create(self, wd, mask, name):
		if mask & inotifyx.IN_ISDIR:
			self._watchPath(self.wds[wd], name)

	def _watchPath(self, parent, item):
		if parent.children is not None and item in parent.children:
			return
		try:
			WatchedPath(self, parent, item)
		except IOError as e:
			if e.errno == errno.ENOENT:
				print "[monitor] ENOENT:", os.path.join(parent.path, item)
			elif e.errno == errno.EACCES:
				print "[monitor] EACCES: ", os.path.join(parent.path, item)
			else:
				raise

	def processEvents(self, events):
		i = 0
		l = len(events)
		while i < l:
			e = events[i]
			i += 1
			if e.mask & inotifyx.IN_MOVED_FROM:
				if i < l and (events[i].cookie == e.cookie):
					e2 = events[i]
					print e2
					assert e2.mask == (inotifyx.IN_MOVED_TO | e.mask & inotifyx.IN_ISDIR)
					i += 1
					self._move(e.wd, e2.wd, e.mask, e.name, e2.name)
				else:
					self._move(e.wd, None, e.mask, e.name, e.name)
			elif e.mask & inotifyx.IN_MOVED_TO:
				self._move(None, e.wd, e.mask, e.name, e.name)
			elif e.mask & inotifyx.IN_MOVE_SELF:
				self._move_self(e.wd, e.mask, e.name)
			elif e.mask & inotifyx.IN_DELETE_SELF:
				self._delete_self(e.wd, e.mask, e.name)
			elif e.mask & inotifyx.IN_CREATE:
				self._create(e.wd, e.mask, e.name)
			elif e.mask & inotifyx.IN_ATTRIB:
				self._attrib(e.wd, e.mask, e.name)
			elif e.mask & inotifyx.IN_CLOSE_WRITE:
				self._close_write(e.wd, e.mask, e.name)
			elif e.mask & inotifyx.IN_DELETE:
				self._delete(e.wd, e.mask, e.name)
			elif e.mask & inotifyx.IN_IGNORED:
				pass
			else:
				print "???", e
		events = inotifyx.get_events(self.fd, 0)
		if events:
			self.enqueue(ProcessEvents(events))

	def enqueue(self, task):
		heapq.heappush(self.queue, task)

	def run(self):
		while True:
			timeout = ()

			if self.queue:
				heapq.heappop(self.queue).run(self)
				timeout = (0,)
			events = inotifyx.get_events(self.fd, *timeout)
			if events:
				self.enqueue(ProcessEvents(events))


class TestMonitor(Monitor):
	def __init__(self):
		super(TestMonitor, self).__init__()
		self.lib = {}

	def add(self, dstPath):
		dstDir, dstName = os.path.split(dstPath)
		dst = tri_walk(self.lib, dstDir)

		dst[dstName] = True
		print "+", dstPath

	def move(self, srcPath, dstPath, isDir):
		srcDir, srcName = os.path.split(srcPath)
		src = tri_walk(self.lib, srcDir)

		dstDir, dstName = os.path.split(dstPath)
		dst = tri_walk(self.lib, dstDir)

		if srcName in src:
			dst[dstName] = src.pop(srcName)
		print ("file", "dir")[isDir], srcPath, "->", dstPath

	def remove(self, srcPath, isDir):
		srcDir, srcName = os.path.split(srcPath)
		src = tri_walk(self.lib, srcDir)

		src.pop(srcName, None)
		print ("file", "dir")[isDir], "-", srcPath

	def _dump(self, path, w, l, indent=0):
		prefix = "  "*indent
		print prefix + path + ":"
		for child in (w.children or {}).itervalues():
			self._dump(os.path.join(path, child.name), child, l.setdefault(child.name, {}), indent)
		for k, v in l.iteritems():
			if v is True:
				print os.path.join(path, k)

	def cleanup(self):
		print "cleanup"

if __name__ == '__main__':
	m = TestMonitor()
	m.addRoot("/home/apexo/t")
	#m.addRoot("/home/apexo/ext/media")
	m.run()
