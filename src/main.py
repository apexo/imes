import yaml
import pprint
import argparse

import database
import monitor

class Adapter(monitor.Monitor):
	def __init__(self, db):
		super(Adapter, self).__init__()
		self.db = db

	def add(self, dstPath):
		self.db.update(dstPath)

	def move(self, srcPath, dstPath, isDir):
		if isDir:
			self.db.move(srcPath, dstPath)
		else:
			self.db.remove(srcPath, False)
			self.db.update(dstPath)

	def remove(self, srcPath, isDir):
		self.db.remove(srcPath, isDir)

	def cleanup(self):
		self.db.cleanup()

def interact(db):
	prefix = u"org.couchdb.user:"
	users = db._db["_users"]
	helpText = """
commands:

help: display this help text
add_user([name]): create user
promote(name): add imes_user role to user named `name`
demote(name): remove imes_user role from user named `name`
"""
	class Helper(object):
		def __call__(self):
			print helpText

		def __str__(self):
			return helpText
		def __repr__(self):
			return helpText

	def add_user(name=None):
		if isinstance(name, unicode):
			pass
		elif isinstance(name, str):
			name = name.decode("UTF-8")
		elif name is None:
			name = raw_input("name: ").decode("UTF-8")
		else:
			raise ValueError(name)
		if name in (u"", u"loco", u"admin", u"root") or u" " in name:
			raise ValueError(name)
		if prefix+name in users:
			print "user already exists"
			return
		pw = raw_input("password: ").decode("UTF-8")
		pw2 = raw_input("password (repeat): ").decode("UTF-8")
		if pw != pw2:
			print "passwords don't match"
		users[prefix+name] = {
			u"name": name,
			u"password": pw,
			u"roles": [u"imes_user"],
			u"type": u"user",
		}

	def promote(name):
		user = users[prefix+name]
		try:
			user["roles"].remove("imes_user")
		except ValueError:
			pass
		user["roles"].append("imes_user")
		users[prefix+name] = user

	def demote(name):
		user = users[prefix+name]
		user["roles"].remove("imes_user")
		users[prefix+name] = user

	import code
	code.InteractiveConsole({
		"help": Helper(),
		"add_user": add_user,
		"_db": db._db,
		"promote": promote,
		"demote": demote,
	}).interact()
	#while True:
	#	terms = raw_input(">").decode("UTF-8")
	#	for id in db.search(terms):
	#		row = db.files[id]
	#		print u"%-40s %-40s %-40s" % (row.get("album", [""])[0], row.get("artist", [""])[0], row.get("title", [""])[0])
	#		print row

def main():
	p = argparse.ArgumentParser()
	p.add_argument("--config", "-c", type=argparse.FileType(), default="config.yaml")

	action = p.add_mutually_exclusive_group()
	action.add_argument("--scan", "-S", action="store_true", help="(default)")
	action.add_argument("--check-config", "-C", action="store_true")
	action.add_argument("--update", "-U", action="store_true")
	action.add_argument("--interactive", "-I", action="store_true")

	args = p.parse_args()

	config = yaml.load(args.config)

	if args.check_config:
		pprint.pprint(config)
		return

	db = database.Database(
		config["database"]["url"],
		config["database"]["name"],
		config["backend_uri"],
	)

	db.update_data(".")
	if args.update:
		return

	if args.interactive:
		interact(db)
		return

	adapter = Adapter(db)

	for path in config["media"]:
		adapter.addRoot(path)
	adapter.deferCleanup()

	db.prepare()
	adapter.run()

if __name__ == '__main__':
	main()
