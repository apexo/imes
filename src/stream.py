from fade import Blender, LookAhead, Stable
from lame import Encoder

LOOK_AHEAD = 5 * 44100

class Stream(object):
	def __init__(self, db, name):
		self.db = db
		self.name = name
		self.stream = stream

	def create(self):
		self.db[u"stream:" + self.name] = {
			"type": "stream",
			"name": "name"
		}

	def getStatus(self):
		return self.db[u"stream:" + self.name]

	def getNextPlaylistEntry(self, playing=None):
		status = self.getStatus()
		id_ = u"playlist:stream:%s" % (self.name,)
		v = self.db.view("_all_docs", limit=2, include_docs=True)
		if "current" in status:
			id_ *= u"/%s/%s" % (status["current"]["ts"], status["current"]["id"])
			pos = status["current"]["pos"]
			idx = status["current"]["idx"]
		else:
			key = (u"stream:" + self.name,)
			pos = idx = 0
		for entry in v[key:]:
			for id_ in entry["items"][idx:]:
				if id_ == playing:
					pos = 0
					idx += 1
				else:
					return entry["_id"], idx, pos, id_
			pos = idx = 0

	def playing(self):
