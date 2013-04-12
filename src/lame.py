from cffi import FFI
import numpy

from src.fade import EOF, BUFFER_SIZE, SAMPLE_RATE, SAMPLE_TYPE

CDEF = """
typedef enum vbr_mode_e {
  vbr_off=0,
  vbr_mt,               /* obsolete, same as vbr_mtrh */
  vbr_rh,
  vbr_abr,
  vbr_mtrh,
  vbr_max_indicator,    /* Don't use this! It's used for sanity checks.       */
  vbr_default=4    /* change this to change the default VBR mode of LAME */
} vbr_mode;

/* MPEG modes */
typedef enum MPEG_mode_e {
  STEREO = 0,
  JOINT_STEREO,
  DUAL_CHANNEL,   /* LAME doesn't supports this! */
  MONO,
  NOT_SET,
  MAX_INDICATOR   /* Don't use this! It's used for sanity checks. */
} MPEG_mode;

/* Padding types */
typedef enum Padding_type_e {
  PAD_NO = 0,
  PAD_ALL,
  PAD_ADJUST,
  PAD_MAX_INDICATOR   /* Don't use this! It's used for sanity checks. */
} Padding_type;

/*presets*/
typedef enum preset_mode_e {
    /*values from 8 to 320 should be reserved for abr bitrates*/
    /*for abr I'd suggest to directly use the targeted bitrate as a value*/
    ABR_8 = 8,
    ABR_320 = 320,

    V9 = 410, /*Vx to match Lame and VBR_xx to match FhG*/
    VBR_10 = 410,
    V8 = 420,
    VBR_20 = 420,
    V7 = 430,
    VBR_30 = 430,
    V6 = 440,
    VBR_40 = 440,
    V5 = 450,
    VBR_50 = 450,
    V4 = 460,
    VBR_60 = 460,
    V3 = 470,
    VBR_70 = 470,
    V2 = 480,
    VBR_80 = 480,
    V1 = 490,
    VBR_90 = 490,
    V0 = 500,
    VBR_100 = 500,



    /*still there for compatibility*/
    R3MIX = 1000,
    STANDARD = 1001,
    EXTREME = 1002,
    INSANE = 1003,
    STANDARD_FAST = 1004,
    EXTREME_FAST = 1005,
    MEDIUM = 1006,
    MEDIUM_FAST = 1007
} preset_mode;

/*asm optimizations*/
typedef enum asm_optimizations_e {
    MMX = 1,
    AMD_3DNOW = 2,
    SSE = 3
} asm_optimizations;

/* psychoacoustic model */
typedef enum Psy_model_e {
    PSY_GPSYCHO = 1,
    PSY_NSPSYTUNE = 2
} Psy_model;

/* buffer considerations */
typedef enum buffer_constraint_e {
    MDB_DEFAULT=0,
    MDB_STRICT_ISO=1,
    MDB_MAXIMUM=2
} buffer_constraint;

struct lame_global_struct;
typedef struct lame_global_struct lame_global_flags;
typedef lame_global_flags *lame_t;

lame_global_flags * lame_init(void);

int lame_set_num_samples(lame_global_flags *, unsigned long);
int lame_set_out_samplerate(lame_global_flags *, int);
int lame_set_bWriteVbrTag(lame_global_flags *, int);
int lame_set_quality(lame_global_flags *, int);
int lame_set_mode(lame_global_flags *, MPEG_mode);
int lame_set_brate(lame_global_flags *, int);
int lame_set_compression_ratio(lame_global_flags *, float);
int lame_set_preset( lame_global_flags*  gfp, int );
int lame_set_asm_optimizations( lame_global_flags*  gfp, int, int );
int lame_set_VBR(lame_global_flags *, vbr_mode);
int lame_set_VBR_q(lame_global_flags *, int);
int lame_set_VBR_quality(lame_global_flags *, float);

/* size of MPEG frame */
int lame_get_framesize(const lame_global_flags *);

/* number of PCM samples buffered, but not yet encoded to mp3 data. */
int lame_get_mf_samples_to_encode( const lame_global_flags*  gfp );

/*
  size (bytes) of mp3 data buffered, but not yet encoded.
  this is the number of bytes which would be output by a call to
  lame_encode_flush_nogap.  NOTE: lame_encode_flush() will return
  more bytes than this because it will encode the reamining buffered
  PCM samples before flushing the mp3 buffers.
*/
int lame_get_size_mp3buffer( const lame_global_flags*  gfp );


/* encoder delay   */
int lame_get_encoder_delay(const lame_global_flags *);


/*
 * REQUIRED:
 * sets more internal configuration based on data provided above.
 * returns -1 if something failed.
 */
int lame_init_params(lame_global_flags *);


/*
 * OPTIONAL:
 * print internal lame configuration to message handler
 */
void lame_print_config(const lame_global_flags*  gfp);

void lame_print_internals( const lame_global_flags *gfp);


/*
 * input pcm data, output (maybe) mp3 frames.
 * This routine handles all buffering, resampling and filtering for you.
 *
 * return code     number of bytes output in mp3buf. Can be 0
 *                 -1:  mp3buf was too small
 *                 -2:  malloc() problem
 *                 -3:  lame_init_params() not called
 *                 -4:  psycho acoustic problems
 *
 * The required mp3buf_size can be computed from num_samples,
 * samplerate and encoding rate, but here is a worst case estimate:
 *
 * mp3buf_size in bytes = 1.25*num_samples + 7200
 *
 * I think a tighter bound could be:  (mt, March 2000)
 * MPEG1:
 *    num_samples*(bitrate/8)/samplerate + 4*1152*(bitrate/8)/samplerate + 512
 * MPEG2:
 *    num_samples*(bitrate/8)/samplerate + 4*576*(bitrate/8)/samplerate + 256
 *
 * but test first if you use that!
 *
 * set mp3buf_size = 0 and LAME will not check if mp3buf_size is
 * large enough.
 *
 * NOTE:
 * if gfp->num_channels=2, but gfp->mode = 3 (mono), the L & R channels
 * will be averaged into the L channel before encoding only the L channel
 * This will overwrite the data in buffer_l[] and buffer_r[].
 *
*/
int lame_encode_buffer (
        lame_global_flags*  gfp,           /* global context handle         */
        const short int     buffer_l [],   /* PCM data for left channel     */
        const short int     buffer_r [],   /* PCM data for right channel    */
        const int           nsamples,      /* number of samples per channel */
        unsigned char*      mp3buf,        /* pointer to encoded MP3 stream */
        const int           mp3buf_size ); /* number of valid octets in this
                                              stream                        */

/*
 * as above, but input has L & R channel data interleaved.
 * NOTE:
 * num_samples = number of samples in the L (or R)
 * channel, not the total number of samples in pcm[]
 */
int lame_encode_buffer_interleaved(
        lame_global_flags*  gfp,           /* global context handlei        */
        short int           pcm[],         /* PCM data for left and right
                                              channel, interleaved          */
        int                 num_samples,   /* number of samples per channel,
                                              _not_ number of samples in
                                              pcm[]                         */
        unsigned char*      mp3buf,        /* pointer to encoded MP3 stream */
        int                 mp3buf_size ); /* number of valid octets in this
                                              stream                        */


/*
 * REQUIRED:
 * lame_encode_flush will flush the intenal PCM buffers, padding with
 * 0's to make sure the final frame is complete, and then flush
 * the internal MP3 buffers, and thus may return a
 * final few mp3 frames.  'mp3buf' should be at least 7200 bytes long
 * to hold all possible emitted data.
 *
 * will also write id3v1 tags (if any) into the bitstream
 *
 * return code = number of bytes output to mp3buf. Can be 0
 */
int lame_encode_flush(
        lame_global_flags *  gfp,    /* global context handle                 */
        unsigned char*       mp3buf, /* pointer to encoded MP3 stream         */
        int                  size);  /* number of valid octets in this stream */


/*
 * OPTIONAL:    some simple statistics
 * a bitrate histogram to visualize the distribution of used frame sizes
 * a stereo mode histogram to visualize the distribution of used stereo
 *   modes, useful in joint-stereo mode only
 *   0: LR    left-right encoded
 *   1: LR-I  left-right and intensity encoded (currently not supported)
 *   2: MS    mid-side encoded
 *   3: MS-I  mid-side and intensity encoded (currently not supported)
 *
 * attention: don't call them after lame_encode_finish
 * suggested: lame_encode_flush -> lame_*_hist -> lame_close
 */

void lame_bitrate_hist(
        const lame_global_flags * gfp,
        int bitrate_count[14] );
void lame_bitrate_kbps(
        const lame_global_flags * gfp,
        int bitrate_kbps [14] );
void lame_stereo_mode_hist(
        const lame_global_flags * gfp,
        int stereo_mode_count[4] );

// breaks cffi
/* void lame_bitrate_stereo_mode_hist (
        const lame_global_flags * gfp,
        int bitrate_stmode_count[14][4] ); */

void lame_block_type_hist (
        const lame_global_flags * gfp,
        int btype_count[6] );

// breaks cffi
/* void lame_bitrate_block_type_hist (
        const lame_global_flags * gfp,
        int bitrate_btype_count[14][6] ); */


/*
 * REQUIRED:
 * final call to free all remaining buffers
 */
int lame_close (lame_global_flags *);
"""

ffi = FFI()
ffi.cdef(CDEF)
lib = ffi.verify("#include <lame/lame.h>", libraries=["mp3lame"])

class Encoder(object):
	SILENCE = b'LAME3.99.5UUUUUUUUUUUUUUUUUUUUUUUUU\xff\xfb\x10d\xdd\x8f\xf0\x00\x00i\x00\x00\x00\x08\x00\x00\r \x00\x00\x01\x00\x00\x01\xa4\x00\x00\x00 \x00\x004\x80\x00\x00\x04UUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUU'

	def __init__(self, src, channels=2, sampleRate=SAMPLE_RATE, q=2, preset=lib.VBR_80, vbr_q=2, vbr_mode=lib.vbr_default, debug=0, sampleType=SAMPLE_TYPE):
		lame = lib.lame_init()
		if not lame:
			raise Exception("error initializing lame")
		if sampleRate is not None:
			self.checkError(lib.lame_set_out_samplerate(lame, sampleRate))
		self.checkError(lib.lame_set_bWriteVbrTag(lame, 0))
		if q is not None:
			self.checkError(lib.lame_set_quality(lame, q))
		if preset is not None:
			self.checkError(lib.lame_set_preset(lame, preset))
		self.checkError(lib.lame_set_VBR(lame, vbr_mode))
		if vbr_q is not None:
			self.checkError(lib.lame_set_VBR_q(lame, vbr_q))
		self.checkError(lib.lame_init_params(lame))

		if debug:
			lib.lame_print_config(lame)
			lib.lame_print_internals(lame)

		self.frameSize = lib.lame_get_framesize(lame)
		self.tempSize = self.frameSize + (self.frameSize + 3) // 4 + 7200 # worst-case estimate
		self.temp = ffi.new("unsigned char[]", self.tempSize)
		self.view = memoryview(ffi.buffer(self.temp))
		self.lame = lame
		self.read = self.write = 0
		self.samplesInterleaved = ffi.new("short int[]", BUFFER_SIZE * channels)
		self.samplesBuffer = ffi.buffer(self.samplesInterleaved)
		self.samplesTemp = numpy.frombuffer(self.samplesBuffer, dtype=numpy.uint16).reshape((BUFFER_SIZE, channels))
		self.samplesView = memoryview(self.samplesBuffer)
		self.src = src
		self._j = 928

	def checkError(self, result):
		if result < 0:
			raise Exception("lame error: %r" % (result,))
		return result

	def read_into(self, buf, ofs, limit):
		if self.read < self.write > 0:
			n = min(limit, self.write - self.read)
			buf[ofs : ofs + n] = self.view[self.read : self.read + n]
			self.read += n
			return n
		if self.src is EOF:
			return 0
		n = min(len(self.samplesTemp), self.frameSize - self._j)
		while True:
			if n < 0:
				n = min(self.frameSize, len(self.samplesTemp))
			assert 0 < n <= len(self.samplesTemp)
			samples, self.src = self.src.read_into(self.samplesTemp, 0, n)
			if not samples:
				self.write = self.checkError(lib.lame_encode_flush(self.lame, self.temp, self.tempSize))
				self.read = 0
				return self.read_into(buf, ofs, limit)
			self._j += samples
			assert self._j <= self.frameSize, (self._j, samples)
			if self._j == self.frameSize:
				self._j = 0
			self.write = self.checkError(lib.lame_encode_buffer_interleaved(self.lame, self.samplesInterleaved, samples, self.temp, self.tempSize))
			if self.write:
				#print "->", self.write
				m = min(limit, self.write)
				buf[ofs : ofs + m] = self.view[0 : m]
				self.read = m
				return m
			n = min(len(self.samplesTemp), self.frameSize - self._j)
