import os
import yaml
import pprint
import argparse
import signal
import errno

import database
import monitor
import reactor
import select
import rtp

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

def runScanner(db, config):
	adapter = Adapter(db)

	for path in config["media"]:
		adapter.addRoot(path)
	adapter.deferCleanup()

	db.prepare()
	adapter.run()

def runBackend(db, config):
	r = reactor.Reactor()
	handler = rtp.RTSPHandler((config["backend"]["bind_host"], config["backend"]["bind_port"]), config["backend"]["rtp_port"], config["database"]["origin"], db.db, db._db["_users"], r)
	try:
		r.run()
	except KeyboardInterrupt:
		pass

def runAll(db, config, args):
	processes = set()
	unwell = [False]

	db.cleanConnCache()

	if args.scan:
		pid = os.fork()
		if not pid:
			runScanner(db, config)
			raise SystemExit()
		processes.add(pid)
	if args.backend:
		pid = os.fork()
		if not pid:
			runBackend(db, config)
			raise SystemExit()
		processes.add(pid)

	def childExited(signo=None, frame=None):
		pid, status = os.waitpid(-1, os.WNOHANG)
		if not pid:
			return
		assert pid in processes
		processes.discard(pid)
		unwell[0] = True

	signal.signal(signal.SIGCHLD, childExited)

	if not processes:
		print "nothing to do"
		return

	p = select.epoll()
	while not unwell[0]:
		try:
			p.poll()
		except KeyboardInterrupt:
			break
		except IOError as e:
			if e.errno != errno.EINTR:
				raise

	if unwell[0]:
		print "child exited, stopping"
	else:
		print "exiting"

	for pid in processes:
		os.kill(pid, signal.SIGTERM)

	while processes:
		try:
			p.poll(5000)
		except KeyboardInterrupt:
			break
		except IOError as e:
			if e.errno != errno.EINTR:
				raise

	if processes:
		print "killing remaining processes"

	for pid in processes:
		os.kill(pid, signal.SIGKILL)

def runDaemon(db, config, args):
	p = args.pid_file
	f = open(p, "wb") if p else None
	pid = os.fork()
	if not pid:
		if f:
			f.close()
		try:
			runAll(db, config, args)
		finally:
			if p:
				os.unlink(p)
		return
	if f:
		f.write("%d\n" % pid)
		f.close()

def run(db, config, args):
	if args.daemon:
		runDaemon(db, config, args)
	else:
		runAll(db, config, args)

def main():
	p = argparse.ArgumentParser()
	p.add_argument("--config", "-c", type=argparse.FileType(), default="config.yaml")

	action = p.add_mutually_exclusive_group()
	action.add_argument("--check-config", "-C", action="store_true")
	action.add_argument("--interactive", "-I", action="store_true")
	action.add_argument("--update", "-U", action="store_true")
	action.add_argument("--start", "-S", action="store_true", help="(default)")

	p.add_argument("--no-scan", dest="scan", default=True, action="store_false", help="(default: scan enabled)")
	p.add_argument("--no-backend", dest="backend", default=True, action="store_false", help="(default: backend enabled)")
	p.add_argument("--daemon", "-D", action="store_true")
	p.add_argument("--pid-file", "-P")

	args = p.parse_args()

	config = yaml.load(args.config)

	if args.check_config:
		pprint.pprint(config)
		return

	db = database.Database(
		config["database"]["url"],
		config["database"]["name"],
		config["backend"]["public"],
		config["backend"]["public_rtsp"],
		config["backend"]["public_delegate"],
	)

	if args.interactive:
		interact(db)
		return

	db.update_data(".")
	if args.update:
		return

	run(db, config, args)

if __name__ == '__main__':
	main()
