import uuid

class PlaylistEntry(object):
	__slots__ = ["uuid", "ref"]

	def __init__(self, ref):
		self.uuid = uuid.uuid4().bytes.encode("base64")[:21]
		self.ref = ref

class Stream(object):
	def __init__(self):
		self.pl = []
	pass
