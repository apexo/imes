class Delegate(object):
	devices = []
	pause = False

class Device(object):
	aggregate = ...
	active_streams = []

class Aggregate(object):
	channel = ...
	users = []

class User(object):
	aggregate = ...
	pause = False

	@property
	def pause(self):
		return self.__paused

class Channel(object):
	aggregates = []
	pause = True

CHANNEL_SILENCE = ""

class MediaStream(object):
	def __init__(self, channel):
		self.channel = channel

def update(d, key, value, default):
	if value == default:
		d.pop(key, None)
	else:
		d[key] = value

def update_set(d, value, included):
	if included:
		d.add(value)
	else:
		d.discard(value)

def update_nested_set(d, key, value, included):
	if included:
		d.setdefault(key, set()).add(value)
	elif key in d:
		d[key].discard(value)
		if not d[key]:
			d.pop(key)

class State(object):
	def __init__(self):
		self.aggregateChannel = {}
		self.aggregateDevices = {}
		self.aggregateUsers = {}
		self.channelAggregates = {}
		self.delegateDevices = {}
		self.deviceAggregate = {}
		self.deviceDelegates = {}
		self.userAggregate = {}

		self.delegatePaused = set()
		self.channelPaused = {}
		self.deviceSessions = {}

		self._deviceChannel = {}
		self._channelPaused = set()
		self._devicePaused = set()

		self._pendingDeviceUpdates = set()
		self._pendingChannelUpdates = set()

	def setUserAggregate(self, user, aggregate):
		old = self.userAggregate.get(user)
		if old == aggregate:
			return

		if old is not None:
			update_nested_set(self.aggregateUsers, old, user, False)
		update(self.userAggregate, user, aggregate, None)
		if aggregate is not None:
			update_nested_set(self.aggregateUsers, aggregate, user, True)

		if old is not None:
			self._pendingDeviceUpdates |= self.aggregateDevices.get(old)
		if aggregate is not None:
			self._pendingDeviceUpdates |= self.aggregateDevices.get(aggregate)
		self._updateState()

	def setAggregateChannel(self, aggregate, channel):
		old = self.aggregateChannel.get(aggregate)
		if old == channel:
			return

		if old is not None:
			update_nested_set(self.channelAggregates, old, aggregate, False)
		update(self.aggregateChannel, aggregate, channel, None)
		if channel is not None:
			update_nested_set(self.channelAggregates, channel, aggregate, True)

		self._pendingDeviceUpdates |= self.aggregateDevices.get(aggregate, set())
		self._updateState()

	def setDeviceAggregate(self, device, aggregate):
		old = self.deviceAggregate.get(device)
		if old == aggregate:
			return

		if old is not None:
			update_nested_set(self.aggregateDevices, old, device, False)
		update(self.deviceAggregate, device, aggregate, None)
		if aggregate is not None:
			update_nested_set(self.aggregateDevices, aggregate, device, False)

		self._pendingDeviceUpdates.add(device)
		self._updateState()

	def setDelegateDevices(self, delegate, devices):
		oldDevices = self.delegateDevices.get(delegate, [])
		if oldDevices == devices:
			return

		newDevices = set(devices)
		affectedDevices = newdevices ^ set(oldDevices)

		for device in affectedDevices:
			update_set(self.deviceDelegates.setdefault(device, set()), delegate, device in newDevices)
		update(self.delegateDevices, delegate, devices, [])

		self._pendingDeviceUpdates |= affectedDevices
		self._updateState()

	def setDelegatePaused(self, delegate, paused):
		old = delegate in self.delegatePaused
		if old == paused:
			return

		update_set(self.delegatePaused, delegate, paused)

		self._pendingDeviceUpdates |= set(self.delegateDevices.get(delegate, []))
		self._updateState()

	def setChannelPaused(self, channel, paused):
		old = channel in self.channelPaused
		if old == paused:
			return

		update_set(self.channelPaused, channel, paused)

		self._pendingChannelUpdates.add(channel)
		self._updateState()

	def _updateChannelState(self, channel):
		oldPaused = channel in self._channelPaused
		paused = channel in self.channelPaused or all(device in self._devicePaused
			for aggregate in self.channelAggregates.get(channel, set())
			for device in self.aggregateDevices.get(aggregate, set())
		)

		if oldPaused != paused:
			update_set(self._channelPaused, channel, paused)
			self.pauseChannel(self, channel, paused)

	def _updateDeviceState(self, device):
		aggregate = self.deviceAggregate.get(device)
		channel = self.aggregateChannel.get(aggregate)

		paused = not self.aggregateUsers.get(aggregate, set()) or bool(self.delegatePaused & self.deviceDelegates.get(device, set()))

		oldChannel = self._deviceChannel.get(device)
		if oldChannel != channel:
			self._pendingChannelUpdates.add(oldChannel)
			self._pendingChannelUpdates.add(channel)
			update(self._deviceChannel, device, channel, None)
			for session in self.deviceSessions.get(device, set()):
				self.portSession(session, oldChannel, channel, paused)

		oldPaused = device in self._devicePaused
		if oldPaused != paused:
			update_set(self._devicePaused, device, paused)
			if oldChannel == channel:
				for session in self.deviceSessions.get(device, set()):
					self.pauseSession(session, paused)
				self._pendingChannelUpdates.add(channel)

	def _updateState(self):
		while self._pendingDeviceUpdates:
			self._updateDeviceState(self._pendingDeviceUpdates.pop())

		while self._pendingChannelUpdates:
			self._updateChannelState(self._pendingChannelUpdates.pop())

	def portSession(self, session, oldChannel, newChannel, paused):
		pass

	def pauseSession(self, session, paused):
		pass

	def addSession(self, device, session):
		update_nested_set(self.deviceSessions, device, session, True)

	def removeSession(self, device, session):
		update_nested_set(self.deviceSessions, device, session, False)

	def addDevice(self, device):
		pass

	def removeDevice(self, device):
		pass

	def addAggregate(self, aggregate):
		pass

	def removeAggregate(self, aggregate):
		pass

	def addDelegate(self, delegate):
		pass

	def removeDelegate(self, delegate):
		pass

	def pauseChannel(self, channel, paused):
		pass
