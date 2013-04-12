import time
import random

import pylast

from src.reactor import clock

SCROBBLING_DELAY = 10
SCROBBLING_LIMIT = 20

STATUS_INTERNAL_ERROR = 16

def u(n):
	return u"org.couchdb.user:%s" % (n,)

class Session(object):
	def __init__(self, db, userDb, networkName, network, userName, head=None):
		self.db = db
		self.userDb = userDb
		self.networkName = networkName
		self.network = network
		self.prefix = u"history:" + userName + u":"
		self.head = head if head else self.prefix
		self.userName = userName

	def scrobbleSome(self):
		tracks = []
		for item in self.db.view("_all_docs", limit=SCROBBLING_LIMIT, include_docs=True)[self.head:]:
			if not item.id.startswith(self.prefix):
				break
			tracks.append(item.doc)
		if not tracks:
			return True
		result = len(tracks) < SCROBBLING_LIMIT
		self.network.scrobble_many(tracks)
		# success, apparently
		user = self.userDb.get(u(self.userName))
		networkConfig = user.get("imes", {}).get("scrobbler", {}).get(self.networkName)
		if networkConfig is not None:
			networkConfig["head"] = self.head = tracks[-1]["_id"] + ":"
			self.userDb[u(self.userName)] = user
		return result

class Scrobbler(object):
	def __init__(self, db, userDb, reactor, config):
		self.db = db
		self.userDb = userDb
		self.reactor = reactor

		self.pending = set()
		self.sessions = {}
		self.networkFactory = {}

		for k, v in {
			"lastfm": self._lastfm,
			#"librefm": self._librefm, # track.scrobble doesn't work, maybe use old (1.2) submission API?
		}.iteritems():
			if k in config:
				self.networkFactory[k] = v(config[k]["key"], config[k]["secret"])

		self.scheduled = False
		self._catchupAll()

	def _lastfm(self, key, secret):
		def factory(session_key=None):
			return pylast.LastFMNetwork(key, secret, session_key)
		return factory

	def _librefm(self, key, secret):
		def factory(session_key=None):
			network = pylast.LibreFMNetwork(key, secret, session_key)
			network.ws_server = ("alpha.libre.fm", "/2.0/")
			network.homepage = "http://alpha.libre.fm"
			return network
		return factory

	def scrobble(self, userNames, fid):
		info = self.db.get(fid)
		if not info:
			print "error scrobbling %s for %s: not found in database" % (fid, userNames)
			return
		length = info.get("info", {}).get("length", 30)
		if not isinstance(length, (int, float)):
			print "illegal length in %s" % (fid,)
		length = int(length + 0.5)

		t = time.time() - length # estimated start time, not very exact ...
		ts = "%d%03d" % (int(t), int((t - int(t)) * 1000 + 0.5))

		si = {
			"type": "history",
			"fid": fid
		}

		# required fields
		si["timestamp"] = int(t)

		if info.get("artist"):
			si["artist"] = info["artist"][0]
		else:
			return

		if info.get("title"):
			si["title"] = info["title"][0]
		else:
			return

		# optional fields
		if "info" in info and "length" in info["info"]:
			si["duration"] = length
		if info.get("album"):
			si["album"] = info["album"][0]
		if info.get("tracknumber") is not None:
			si["track_number"] = info["tracknumber"]
		if info.get("musicbrainz_trackid"):
			si["mbid"] = info["musicbrainz_trackid"][0]
		if info.get("albumartist"):
			si["album_artist"] = info["albumartist"][0]

		print "scrobbling info", repr(si), repr(userNames)

		for userName in userNames:
			self.db[u"history:%s:%s" % (userName, ts)] = dict(si, user=userName)
			self.pending.add(userName)

		self._catchupLater()

	def _updateSessions(self, userName):
		user = self.userDb.get(u(userName))
		if not user:
			self.sessions.pop(userName, None)
			return
		userSessions = self.sessions.setdefault(userName, {})
		remove = set(userSessions)
		for networkName, networkConfig in user.get("imes", {}).get("scrobbler", {}).iteritems():
			if networkName in self.networkFactory and networkConfig.get("session_token"):
				if networkName not in userSessions:
					network = self.networkFactory[networkName](networkConfig["session_token"])
					userSessions[networkName] = Session(self.db, self.userDb, networkName, network, userName, networkConfig.get("head"))
				remove.discard(networkName)
		for k in remove:
			userSessions.pop(k, None)
		self.pending.add(userName)

	def _catchupAll(self):
		for row in self.userDb.view("_all_docs"):
			if row.id.startswith(u"org.couchdb.user:"):
				self._updateSessions(row.id[17:])

	def _catchupLater(self):
		if self.scheduled:
			return
		self.scheduled = True
		self.reactor.scheduleMonotonic(clock() + SCROBBLING_DELAY, self._doCatchup)

	def _doCatchupUser(self, userName):
		result = True
		userSessions = self.sessions.get(userName, {})
		for networkName, session in userSessions.items():
			try:
				result = result and session.scrobbleSome()
			except pylast.WSError as e:
				if int(e.status) == STATUS_INTERNAL_ERROR:
					# "There was an internal error. Please retry your request."
					result = False
					continue
				if int(e.status) == pylast.STATUS_INVALID_SK:
					user = self.userDb.get(u(userName))
					if user:
						user.get("imes", {}).get("scrobbler", {}).get(networkName, {}).pop("session_key", None)
						self.userDb[u(userName)] = user
					userSessions.pop(networkName, None)
					continue
				raise
		return result

	def _doCatchup(self, t):
		self.scheduled = False
		if self.pending:
			userName = random.choice(list(self.pending))
			if self._doCatchupUser(userName):
				self.pending.discard(userName)
		if self.pending:
			self._catchupLater()

	def removeNetworkConfiguration(self, userName, networkName):
		user = self.userDb.get(u(userName))
		if not user:
			return "error:user not found"
		self.sessions.get(userName, {}).pop(networkName, None)
		networkConfig = user.get("imes", {}).get("scrobbler", {}).get(networkName)
		networkConfig.pop("auth_token", None)
		networkConfig.pop("session_token", None)
		self.userDb[u(userName)] = user
		return True

	def getWebAuthUrl(self, userName, networkName):
		user = self.userDb.get(u(userName))
		if not user:
			return "error:user not found"
		network = self.networkFactory[networkName]()
		networkConfig = user.setdefault("imes", {}).setdefault("scrobbler", {}).setdefault(networkName, {})
		if "auth_token" not in networkConfig:
			skg = pylast.SessionKeyGenerator(network)
			networkConfig["auth_token"] = token = skg._get_web_auth_token()
			self.userDb[u(userName)] = user
		else:
			token = networkConfig["auth_token"]

		# part of get_web_auth_url
		return '%(homepage)s/api/auth/?api_key=%(api)s&token=%(token)s' % {"homepage": network.homepage, "api": network.api_key, "token": token}

	def verifyNetworkConfiguration(self, userName, networkName):
		user = self.userDb.get(u(userName))
		if not user:
			return "error:user not found"
		networkConfig = user.setdefault("imes", {}).setdefault("scrobbler", {}).setdefault(networkName, {})
		if "auth_token" not in networkConfig:
			return "error:missing auth_token"

		# part of get_web_session_auth_key
		request = pylast._Request(self.networkFactory[networkName](), 'auth.getSession', {'token': networkConfig["auth_token"]})
		request.sign_it()
		try:
			doc = request.execute()
		except pylast.WSError as e:
			if int(e.status) == pylast.STATUS_TOKEN_EXPIRED:
				return "error:token is expired, remove and re-start"
			elif int(e.status) == pylast.STATUS_TOKEN_UNAUTHORIZED:
				return "error:not authorized"
			raise
		result = doc.getElementsByTagName('key')[0].firstChild.data

		# success?
		print "verifyNetworkConfiguration", repr(result)

		networkConfig.pop("auth_token")
		networkConfig["session_token"] = result
		self.userDb[u(userName)] = user

		network = self.networkFactory[networkName](result)
		self.sessions.setdefault(userName, {})[networkName] = Session(self.db, self.userDb, networkName, network, userName, networkConfig.get("head"))
		self.pending.add(userName)
		self._catchupLater()

		return True

	def getNetworks(self, userName):
		user = self.userDb.get(u(userName))
		if not user:
			return "error:user not found"
		networkConfigurations = user.get("imes", {}).get("scrobbler", {})
		result = {}
		for networkName in self.networkFactory:
			result[networkName] = networkConfigurations.get(networkName)
		return result
