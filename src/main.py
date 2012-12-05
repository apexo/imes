import yaml
import pprint
import argparse

import database
import monitor

class Adapter(monitor.Monitor):
	def __init__(self, db):
		super(Adapter, self).__init__()
		self.db = db
		self.cookie = database._id(open("/dev/urandom", "rb", 0).read(9))

	def add(self, dstPath):
		self.db.update(dstPath, self.cookie)

	def move(self, srcPath, dstPath, isDir):
		if isDir:
			self.db.move(srcPath, dstPath)
		else:
			self.db.remove(srcPath, False)
			self.db.update(dstPath, self.cookie)

	def remove(self, srcPath, isDir):
		self.db.remove(srcPath, isDir)

	def cleanup(self):
		self.db.cleanup(self.cookie)

def interact(db):
	while True:
		terms = raw_input(">").decode("UTF-8")
		for id in db.search(terms):
			row = db.files[id]
			print u"%-40s %-40s %-40s" % (row.get("album", [""])[0], row.get("artist", [""])[0], row.get("title", [""])[0])
			print row

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

	db = database.Database(config["database"]["url"], config["database"]["prefix"])

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

	adapter.run()

if __name__ == '__main__':
	main()
