# encoding: utf-8
import numpy
import ast
import subprocess
import os

# f(x) = -2x³ + 3x²

# f(0) = 0
# f(1) = 1
# f'(0) = 0
# f'(1) = 0

SAMPLE_RATE = 44100
BUFFER_SIZE = 1152 #SAMPLE_RATE // 100
SAMPLE_TYPE = numpy.int16
SAMPLE_SIZE = len(numpy.zeros(1, SAMPLE_TYPE).view(numpy.uint8))
NUM_CHANNELS = 2
PREROLL_SAMPLES = 11520

def makeBlender(samples, channels=NUM_CHANNELS,
	cache={},
	p=lambda x: (-65536 * x + 98304) * x * x
):
	k = samples, channels
	if k not in cache:
		f = 1.0 / (samples - 1)
		cache[k] = numpy.array([[p(i*f)] * channels for i in xrange(samples)], dtype=numpy.uint16)
	return cache[k]

def singleton(cls):
	return cls()

@singleton
class EOF(object):
	def read_into(self, buf, ofs, limit):
		return 0, self

class Decoder(object):
	def __init__(self, fd, channels=NUM_CHANNELS, sampleType=SAMPLE_TYPE):
		self.fd = fd
		self.temp = numpy.zeros((BUFFER_SIZE, channels), sampleType)
		self.mv = memoryview(self.temp.reshape([channels * BUFFER_SIZE]).view(numpy.uint8))
		self.ofs = 0
		self.bytesPerSample = channels * SAMPLE_SIZE

	def read_into(self, buf, ofs, limit):
		while self.ofs < self.bytesPerSample:
			assert limit > 0
			lim = min(len(self.mv), limit * self.bytesPerSample) - self.ofs
			assert lim > 0, (len(self.mv), limit, self.bytesPerSample, self.ofs)
			data = os.read(self.fd, lim)
			if not data:
				return 0, EOF
			self.mv[self.ofs : self.ofs + len(data)] = data
			self.ofs += len(data)
		n, rem = divmod(self.ofs, self.bytesPerSample)
		assert n > 0, rem >= 0
		#print len(buf), ofs, n, len(self.temp), 0, n
		buf[ofs : ofs + n] = self.temp[0 : n]
		if rem:
			self.mv[0 : rem] = self.mv[self.ofs - rem : self.ofs]
		self.ofs = rem
		return n, self

class SampleCounter(object):
	def __init__(self, src):
		self.src = src
		self.samples = 0

	def read_into(self, buf, ofs, limit):
		n, self.src = self.src.read_into(buf, ofs, limit)
		if n:
			self.samples += n
			return n, self
		return 0, EOF

class SoxDecoder(Decoder):
	def __init__(self, fileName, gain=None, channels=NUM_CHANNELS):
		if gain and gain.endswith("dB"):
			gain = gain[:-2].strip()
		try:
			if not gain or abs(float(gain) < 0.01):
				gain = None
		except ValueError:
			gain = None
		gain = [] if gain is None else ["gain", gain]
		self.p = None
		self.p = subprocess.Popen(["sox", fileName, "-r", str(SAMPLE_RATE), "-b", str(SAMPLE_SIZE * 8), "-c", str(channels), "-t", "raw", "-"] + gain, stdout=subprocess.PIPE)
		super(SoxDecoder, self).__init__(self.p.stdout.fileno(), channels)

	def __del__(self):
		if self.p is not None:
			self.p.stdout.close()
			self.p.wait()

class Zeroer(object):
	def read_into(self, buf, ofs, limit):
		buf[ofs:limit].fill(0)
		return limit, self

zeroer = Zeroer()

class Joiner(object):
	def __init__(self, *items):
		self.items = list(items)
		self.current = self.items.pop(0) if self.items else EOF

	def read_into(self, buf, ofs, limit):
		if not self.items:
			return self.current.read_into(buf, ofs, limit)
		while True:
			assert self.current is not EOF
			n, self.current = self.current.read_into(buf, ofs, limit)
			if n:
				return n, self
			assert self.current is EOF
			if not self.items:
				return 0, EOF
			self.current = self.items.pop(0)

class Stable(object):
	def __init__(self, src, zeroFill=False):
		self.src = src
		self.zeroFill = zeroFill

	def read_into(self, buf, ofs, limit):
		n, self.src = self.src.read_into(buf, ofs, limit)
		if not n:
			if self.zeroZill:
				return zeroer.read_info(buf, ofs, limit)[0], self
			return 0, EOF
		return n, self

class Pauser(object):
	def __init__(self, src, samples, callback, paused=False, channels=NUM_CHANNELS):
		assert isinstance(src, (SampleCounter, Stable))
		self.src = src
		self.pausedSrc = zeroer if paused else src
		self.state = "paused" if paused else "playing"
		self.nextState = "paused" if paused else "playing"
		self.samples = samples
		self.channels = channels
		self.callback = callback

	def pause(self, paused=True):
		self.nextState = "paused" if paused else "playing"

	def read_into(self, buf, ofs, limit):
		if self.state == "playing" and self.nextState == "paused":
			self.pausedSrc = Blender(self.src, zeroer, self.samples, 0, self.channels)
			self.state = "pausing"
		elif self.state == "paused" and self.nextState == "playing":
			self.pausedSrc = Blender(zeroer, self.src, self.samples, 0, self.channels)
			self.state = "resuming"
		n, self.pausedSrc = self.pausedSrc.read_into(buf, ofs, limit)
		if self.state == "pausing" and self.pausedSrc is zeroer:
			self.state = "paused"
			self.callback()
		elif self.state == "resuming" and self.pausedSrc is self.src:
			self.state = "playing"
		if not n:
			return 0, EOF
		return n, self

class Skipper(object):
	def __init__(self, src, samples, channels=NUM_CHANNELS, sampleType=SAMPLE_TYPE):
		self.src = src
		self.samples = samples
		self.tempSize = min(BUFFER_SIZE, samples)
		self.temp = numpy.zeros((self.tempSize, channels), sampleType)

	def preroll(self, limit=None):
		while self.samples:
			lim = min(self.samples, self.tempSize)
			if limit is not None:
				lim = min(lim, limit)
			n, self.src = self.src.read_into(self.temp, 0, lim)
			assert n <= self.tempSize and n <= self.samples
			if not n:
				return True
			self.samples -= n
			if limit is not None:
				limit -= n
				assert limit >= 0
				if limit == 0:
					return False
		return True

	def read_into(self, buf, ofs, limit):
		if self.samples:
			self.preroll()
			if self.samples:
				return 0, EOF
		return self.src.read_into(buf, ofs, limit)

class LookAhead(object):
	def __init__(self, src, samples, callback, channels=NUM_CHANNELS, sampleType=SAMPLE_TYPE):
		self.src = src
		self.remaining = 0
		self.limit = samples
		self.size = samples + BUFFER_SIZE
		self.temp = numpy.zeros((self.size, channels), sampleType)
		self.read = 0
		self.write = 0
		self.callback = callback
		self.eof = False

	def preroll(self, limit=None):
		if hasattr(self.src, "preroll") and not self.src.preroll(limit):
			return False
		return not self.fill(limit)

	def fill(self, limit=None):
		while not self.eof and self.remaining <= self.limit:
			if self.read == self.write and not self.remaining:
				self.read = self.write = 0
				n = self.size
			elif self.write <= self.read:
				n = self.read - self.write
			else:
				n = self.size - self.write
			if limit is not None:
				n = min(limit, n)
			assert n > 0
			n, self.src = self.src.read_into(self.temp, self.write, n)
			if not n:
				self.eof = True
				return
			self.remaining += n
			self.write += n
			if self.write == self.size:
				self.write = 0
			if limit is not None:
				limit -= n
				assert limit >= 0
				if limit == 0:
					return True

	def read_into(self, buf, ofs, limit):
		self.fill()
		if self.eof and self.callback is not None and self.remaining <= self.limit:
			cb, self.limit, self.callback = self.callback, 0, None
			return cb(self).read_into(buf, ofs, limit)
		n = self.remaining - self.limit
		if self.write <= self.read:
			n = min(self.size - self.read, n)
		#print "XXX", self.write, self.read, self.remaining, self.limit, self.size
		n = min(n, limit)
		if n == 0:
			return 0, EOF
		#print len(buf), ofs, n, len(self.temp), self.read, n
		buf[ofs : ofs + n] = self.temp[self.read : self.read + n]
		self.remaining -= n
		self.read += n
		if self.read == self.size:
			self.read = 0
		return n, self

class Blender(object):
	def __init__(self, a, b, samples, delay=0, channels=NUM_CHANNELS, sampleType=SAMPLE_TYPE):
		self.delay = delay
		self.a = a
		self.b = b
		self.samples = makeBlender(samples, channels)
		self.limit = min(BUFFER_SIZE, samples)
		self.bufA = numpy.zeros((self.limit, channels), sampleType)
		self.bufB = numpy.zeros((self.limit, channels), sampleType)
		self.readA = self.readB = self.writeA = self.writeB = 0
		self.channels = channels

		self.state = 0 if delay else 1

		self.idx = 0

	def read_into(self, dst, ofs, limit):
		if self.state == 0:
			n = min(self.delay, limit)
			n, self.a = self.a.read_into(dst, ofs, n)
			if not n:
				return self.b.read_into(dst, ofs, limit)
			self.delay -= n
			if not self.delay:
				self.state = 1
			return n, self

		if self.state == 1:
			self.writeA, self.a = self.a.read_into(self.bufA, 0, self.limit)
			self.writeB, self.b = self.b.read_into(self.bufB, 0, self.limit)
			self.state = 2

		assert self.state == 2
		n = min(self.writeA - self.readA, self.writeB - self.readB, len(self.samples) - self.idx, limit)
		if not n:
			n = min(self.writeB - self.readB, limit)
			if not n:
				return self.b.read_into(dst, ofs, limit)
			dst[ofs : ofs + n] = self.bufB[self.readB : self.readB + n]
			self.readB += n
			return n, self

		a = self.bufA[self.readA : self.readA + n]
		b = self.bufB[self.readB : self.readB + n]
		t = self.samples[self.idx : self.idx + n]
		dst[ofs : ofs + n] = (((b.astype(numpy.int32) - a) * t) >> 15) + a

		self.readA += n
		self.readB += n
		self.idx += n

		lim = min(len(self.samples) - self.idx, self.limit)

		if lim:
			if self.readA == self.writeA:
				self.writeA, self.a = self.a.read_into(self.bufA, 0, lim)
				self.readA = 0
			if self.readB == self.writeB:
				self.writeB, self.b = self.b.read_into(self.bufB, 0, lim)
				self.readB = 0

		return n, self

class WeirdLimiter(object):
	def __init__(self, src, samples, callback):
		self.src = src
		self.samples = samples
		self.callback = callback

	def read_into(self, buf, ofs, limit):
		assert self.samples > 0
		n, self.src = self.src.read_into(buf, ofs, min(limit, self.samples))
		assert 0 <= n <= self.samples
		if not n:
			self.callback(self, False)
			return 0, EOF
		self.samples -= n
		if not self.samples:
			self.callback(self, True)
			if not self.samples:
				return n, self.src
		return n, self

class Limiter(object):
	def __init__(self, src, samples):
		self.src = src
		self.samples = samples

	def read_into(self, buf, ofs, limit):
		assert self.samples >= 0
		if not self.samples:
			return 0, EOF
		#print "limited %d / %r" % (self.samples, self.src)
		n, self.src = self.src.read_into(buf, ofs, min(limit, self.samples))
		assert 0 <= n <= self.samples
		if not n:
			#print "limiter EOF @ %d samples remaining (src=%r)" % (self.samples, self.src)
			return 0, EOF
		self.samples -= n
		return n, self

if __name__ == '__main__':
	def test(src, channels=2, sampleType=SAMPLE_TYPE):
		buf = numpy.zeros((BUFFER_SIZE, channels), sampleType)
		src_old = src
		total = 0
		n, src = src.read_into(buf, 0, len(buf))
		total = n
		while n:
			print "got", n, "samples for a total of", total
			if src is not src_old:
				print "new src:", src
			src_old = src
			n, src = src.read_into(buf, 0, len(buf))
			total += n
		print "done, %d samples" % total

	test(SoxDecoder("/home/apexo/ext/media/Mariah Carey - Without You.mp3", 2))
