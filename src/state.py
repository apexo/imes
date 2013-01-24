import signal
import channel
import os
import struct
from collections import OrderedDict

from reactor import clock
from ipc import Async

USER_SESSION_TIMEOUT = 120
RTSP_SESSION_TIMEOUT = 60
RTP_TIMEOUT = 60
GC_INTERVAL = 15

random = open("/dev/urandom", "rb", 4096)
_never = clock() + 365 * 86400 * 100

def createAuthToken(self):
	return random.read(30).encode("base64").replace("+", "-").replace("/", ".")

class MonotonicClockValue(object):
	__slots__ = ["value"]

	def __init__(self, value):
		self.value = value

	def adjust(self, dt):
		self.value += dt

class Delegate(object):
	def __init__(self, name, authToken):
		self.name = name
		self.authToken = authToken
		self.devices = set()

		self._paused = False
		self._pausedUntil = None
		self._autoUnpauseToken = None

	def _unpause(self, token, reactor):
		if token == self._autoUnpauseToken:
			assert self._pausedUntil is not None
			reactor.unregisterMonotonicClock(self._pausedUntil)
			self._autoUnpauseToken = None
			self._pausedUntil = None

	def pause(self, paused, timeout, reactor):
		assert timeout is None or paused

		pausedUntil = None if timeout is None else clock() + timeout
		if self._pausedUntil is not None and (timeout is None or pausedUntil > self._pausedUntil.value):
			reactor.unregisterMonotonicClock(self._pausedUntil)
			self._pausedUntil = None
			self._autoUnpauseToken = None

		if paused:
			if timeout is None:
				self._paused = True
			elif self._pausedUntil is None:
				self._pausedUntil = MonotonicClockValue(pausedUntil)
				reactor.registerMonotonicClock(self._pausedUntil)
				self._autoUnpauseToken = random.read(8)
				reactor.scheduleMonotonic(pausedUntil, self._unpause, self._autoUnpauseToken, reactor)
		else:
			self._paused = False

	@property
	def paused(self):
		return self._paused or self._pausedUntil is not None

class Aggregate(object):
	def __init__(self, name):
		self.name = name
		self.users = set()
		self.devices = set()
		self.channel = None

class Device(object):
	def __init__(self, name, authToken):
		self.name = name
		self.authToken = authToken
		self.aggregate = None
		self.delegates = set()

		self.mediaStreams = set()

		self._paused = False
		self._channel = None

	def update(self, state, reactor):
		hasUsers = False if self.aggregate is None else bool(self.aggregate.users)
		paused = any(delegate.paused for delegate in self.delegates) or not hasUsers
		if paused != self._paused:
			for ms in self.mediaStreams:
				state.setMediaStreamPaused(ms, paused)
			self._paused = paused

		newChannel = None if self.aggregate is None or self.aggregate.channel is None else self.aggregate.channel
		if newChannel != self._channel:
			for ms in self.mediaStreams:
				state.setMediaStreamChannel(ms, newChannel)
			self._channel = newChannel

class _Session(object):
	default_timeout = 60

	def __init__(self, _expired=clock()):
		self.expires = _expired

	@property
	def expired(self):
		return clock() > self.expires

	def refresh(self, timeout=None):
		self.expired = clock() + (self.default_timeout if timeout is None else timeout)

class MediaStream(_Session):
	default_timeout = RTP_TIMEOUT

	def __init__(self, ssrc, session, device):
		super(MediaStream, self).__init__()
		self.ssrc = ssrc
		self.session = session
		self.device = device
		self.channel = None
		self.paused = False

	@classmethod
	def generate_ssrc(self, unpack=struct.Struct("I").unpack):
		return unpack(random.read(4))[0]

	def refresh(self, state):
		super(MediaStream, self).refresh()
		self.state._mediaStreams[self.ssrc] = self.state._mediaStreams.pop(self.ssrc)

	def discard(self, state):
		self.session.mediaStreams.remove(self)
		self.session = None
		self.device.mediaStreams.remove(self)
		self.device = None
		if self.channel is not None:
			self.channel.channel.removeMediaStream(self.ssrc)
			self.channel.mediaStreams.remove(self)
			self.channel = None
		state._mediaStreams.pop(self.ssrc)

class Session(_Session):
	default_timeout = RTSP_SESSION_TIMEOUT

	def __init__(self, id, rtpAddr):
		super(Session, self).__init__()
		self.id = id
		self.rtpAddr = rtpAddr
		self.mediaStreams = set()

	@classmethod
	def generate_id(self):
		return random.read(12).encode("base64")

	def refresh(self, state):
		super(Session, self).refresh()
		state._sessions[self.id] = state._sessions.pop(self.id)

	def discard(self, state):
		for ms in list(self.mediaStreams):
			ms.discard(state)
		state._sessions.pop(self.id)

class Channel(object):
	def __init__(self, name):
		self.name = name
		self.aggregates = set()

		self.running = False
		self.channel = None
		self.worker = None
		self.channel_pid = None
		self.worker_pid = None

	def start(self, socket, db, reactor, channelApi, workerApi):
		m2c_r, m2c_w = os.pipe()
		c2m_r, c2m_w = os.pipe()
		m2w_r, m2w_w = os.pipe()
		w2m_r, w2m_w = os.pipe()

		self.channel_pid, self.worker_pid = channel.Channel.fork(socket, db, self.name,
			m2c_r, c2m_w, m2w_r, w2m_w,
			m2c_w, c2m_r, m2w_w, w2m_r
		)

		os.close(m2c_r)
		os.close(c2m_w)
		os.close(m2w_r)
		os.close(w2m_w)

		self.channel = Async(channelApi, c2m_r, m2c_w, reactor)
		self.worker = Async(workerApi, w2m_r, m2w_w, reactor)
		reactor.registerPid(self.channel_pid, self._onChildExited)
		reactor.registerPid(self.worker_pid, self._onChildExited)
		self.running = True

	def stop(self):
		if not self.running:
			return
		self.running = False
		self.channel.stop()
		self.worker.stop()
		self.channel = None
		self.worker = None
		if self.worker_pid:
			print "killing channel worker"
			os.kill(self.worker_pid, signal.SIGTERM)
			self.worker_pid = None
		if self.channel_pid:
			print "killing channel processor"
			os.kill(self.channel_pid, signal.SIGTERM)
			self.channel_pid = None

	def _onChildExited(self, pid, status):
		if pid == self.channel_pid:
			print "channel processor for channel %r exited with status %r" % (self.name, status)
			self.channel_pid = None
		elif pid == self.worker_pid:
			print "channel worker for channel %r exited with status %r" % (self.name, status)
			self.worker_pid = None
		else:
			return
		self.stop()

class User(_Session):
	default_timeout = USER_SESSION_TIMEOUT

	def __init__(self, state, name):
		super(User, self).__init__()
		self.name = name

		user = state.userDb[self.key]
		roles = user.get("roles", [])
		imes = user.get("imes", {})
		self.authToken = imes.get("authToken")
		self.authorized = bool(set(roles) & set(["_admin", "imes_user"]) and self.authToken)
		aggregateName = imes.get("aggregate", None)
		self.aggregate = None
		self._initializing = True
		try:
			self.state.setUserAggregate(self, state._aggregates.get(aggregateName))
		finally:
			self._initializing = False

	@property
	def key(self):
		return u"org.couchdb.user:" + self.name

	def save(self, state):
		if self._initializing:
			return
		user = state.userDb[self.key]
		imes = user.setdefault("imes", {})
		aggregateName = None if self.aggregate is None else self.aggregate.name
		if imes.get("aggregate") != aggregateName:
			imes["aggregate"] = aggregateName
			state.userDb[self.key] = user

	def refresh(self, state):
		super(User, self).refresh()
		state._users[self.name] = state._users.pop(self.name)

	def discard(self, state):
		self._initializing = True
		state.setUserAggregate(self, None)
		state._users.pop(self.name)

class State(object):
	def __init__(self, userDb, db, rtpSocket, reactor):
		self.userDb = userDb
		self.db = db
		self.rtpSocket = rtpSocket
		self.reactor = reactor

		self._aggregates = {}
		self._delegates = {}
		self._channels = {}
		self._devices = {}

		self._users = OrderedDict()
		self._mediaStreams = OrderedDict()
		self._sessions = OrderedDict()

		self._collectGarbage()
		self._loadState()

	def _saveState(self):
		state = self.db.get("de.apexo.imes:state", {})
		state.type = "de.apexo.imes:state"
		state.update({
			"aggregates": dict((aggregate.name, {
				"channel": None if aggregate.channel is None else aggregate.channel.name,
			}) for aggregate in self._aggregates.itervalues()),
			"devices": dict((device.name, {
				"authToken": device.authToken,
				"aggregate": None if device.aggregate is None else device.aggregate.name,
			}) for device in self._devices.itervalues()),
			"delegates": dict((delegate.name, {
				"authToken": delegate.authToken,
				"devices": [device.name for device in delegate.devices],
			}) for delegate in self._delegates.itervalues()),
			"channels": [channel.name for channel in self._channels.itervalues()],
		})
		self.db["de.apexo.imes:state"] = state

	def _loadState(self):
		state = self.db.get("de.apexo.imes:state", {
			"aggregates": {},
			"devices": {},
			"delegates": {},
			"channels": [],
		})
		for name in state["channels"]:
			self._channels[name] = Channel(name)
		for name, value in state["aggregates"].iteritems():
			self._aggregates[name] = aggregate = Aggregate(name)
			aggregate.channel = self._channels.get(value["channel"])
			if aggregate.channel is not None:
				aggregate.channel.aggregates.add(aggregate)
		for name, value in state["devices"].iteritems():
			self._devices[name] = device = Device(name, value["authToken"])
			device.aggregate = self._aggregates.get(value["aggregate"])
			if device.aggregate is not None:
				device.aggregate.devices.add(device)
		for name, value in state["delegates"].iteritems():
			self._aggregates[name] = delegate = Delegate(name, value["authToken"])
			delegate.devices = set(self._devices[deviceName] for deviceName in value["devices"] if deviceName in self._devices)
			for device in delegate.devices:
				device.delegates.add(delegate)

	def _collectGarbage(self):
		for collection in (self._mediaStreams, self._sessions, self._users):
			for value in collection.itervalues():
				if not value.expired:
					break
				value.discard(self)

		self.reactor.scheduleMonotonic(clock() + GC_INTERVAL, self._collectGarbage)

	def setUserAggregate(self, user, aggregateName):
		oldAggregate = user.aggregate
		newAggregate = self._aggregates[aggregateName] if aggregateName else None

		if newAggregate is not oldAggregate:
			user.aggregate = newAggregate
			if oldAggregate is not None:
				for device in oldAggregate.devices:
					device.update(self)
			if newAggregate is not None:
				for device in newAggregate.devices:
					device.update(self)
			user.save(self)

	def setAggregateChannel(self, aggregate, channelName):
		channel = self._channels[channelName] if channelName else None

		if aggregate.channel is not channel:
			if aggregate.channel is not None:
				aggregate.channel.aggregates.remove(aggregate)
			if channel is not None:
				channel.aggregates.add(aggregate)
			aggregate.channel = channel
			for device in aggregate.devices:
				device.update(self)
			self._saveState()

	def setDeviceAggregate(self, device, aggregateName):
		aggregate = self._aggregates[aggregateName] if aggregateName else None
		if device.aggregate is not aggregate:
			if device.aggregate is not None:
				device.aggregate.devices.remove(device)
			if aggregate is not None:
				aggregate.devices.add(device)
			device.aggregate = aggregate
			device.update(self)
			self._saveState()

	def setDelegateDevices(self, delegate, deviceNames):
		oldDevices = set(delegate.devices)
		newDevices = set(self._device[deviceName] for deviceName in deviceNames)

		if oldDevices != newDevices:
			for device in oldDevices - newDevices:
				device.delegates.remove(delegate)
			for device in newDevices - oldDevices:
				device.delegates.add(delegate)
			delegate.devices = newDevices
			for device in oldDevices ^ newDevices:
				device.update(self)
			self._saveState()

	def setDelegatePaused(self, delegate, paused, timeout=None):
		assert timeout is None or paused
		delegate.pause(paused, timeout, self.reactor)
		for device in delegate.devices:
			device.update(self)

	def setChannelPaused(self, channel, paused):
		channel.worker.setPaused(paused)

	def getChannelApi(self, channel):
		return {}

	def getWorkerApi(self, channel):
		def scrobble(info):
			pass
		return {"scrobble": scrobble}

	def createMediaStream(self, session, device):
		ssrc = MediaStream.generate_ssrc()
		i = 100
		while ssrc in self._mediaStreams:
			if not i:
				raise KeyError()
			i -= 1
			ssrc = MediaStream.generate_ssrc()
		self._mediaStreams[ssrc] = ms = MediaStream(ssrc, session, device)
		session.mediaStreams.add(ms)
		device.mediaStreams.add(ms)
		ms.refresh(RTP_TIMEOUT)
		self.setMediaStreamPaused(ms, device._paused)
		self.setMediaStreamChannel(ms, device._channel)
		return ms

	def createSession(self, rtpAddr):
		id = Session.generate_id()
		i = 100
		while id in self._sessions:
			if not i:
				raise KeyError()
			i -= 1
			id = Session.generate_id()
		self._sessions[id] = s = Session(id, rtpAddr)
		s.refresh(RTSP_SESSION_TIMEOUT)
		return s

	def createChannel(self, name):
		if name in self._channels:
			raise KeyError()
		self._channels[name] = channel = Channel(name)
		self._saveState()
		return channel

	def listChannels(self):
		return sorted(self._channels)

	def getChannel(self, name):
		return self._delgate[name]

	def createAggregate(self, name):
		if name in self._aggregates:
			raise KeyError()
		self._aggregates[name] = aggregate = Aggregate(name)
		self._saveState()
		return aggregate

	def listAggregates(self):
		return sorted(self._aggregates)

	def getAggregate(self, name):
		return self._delgate[name]

	def createDevice(self, name):
		if name in self._devices:
			raise KeyError()
		self._devices[name] = device = Device(name, createAuthToken())
		self._saveState()
		return device

	def listDevices(self):
		return sorted(self._devices)

	def getDevice(self, name):
		return self._delgate[name]

	def createDelegate(self, name):
		if name in self._delegates:
			raise KeyError()
		self._delegates[name] = delegate = Delegate(name, createAuthToken())
		self._saveState()
		return delegate

	def listDelegates(self):
		return sorted(self._delegates)

	def getDelegate(self, name):
		return self._delgate[name]

	def setMediaStreamPaused(self, mediaStream, paused):
		if mediaStream.paused == paused:
			return
		mediaStream.paused = paused
		if mediaStream.channel is not None:
			mediaStream.channel.channel.pauseMediaStream(mediaStream.ssrc, paused)

	def getUser(self, name):
		if name in self._users:
			user = self._users(name)
		else:
			self._users[name] = user = User(self, name)
		user.refresh()
		return user

	def setMediaStreamChannel(self, mediaStream, channel):
		def proceed(args):
			mediaStream.channel = channel
			if channel is not None:
				if not channel.running:
					channel.start(self.rtpSocket, self.db, self.reactor, self.getChannelApi(channel), self.getWorkerApi(channel))
				channel.channel.addMediaStream(mediaStream.ssrc, mediaStream.session.rtpAddr, mediaStream.paused, *args)
		if mediaStream.channel is channel:
			pass
		elif mediaStream.channel is None:
			proceed(())
		else:
			oldChannel = mediaStream.channel
			mediaStream.channel = None
			oldChannel.channel.removeMediaStream(mediaStream.ssrc, callback=proceed)
