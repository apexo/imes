IMES: Integrated Music Entertainment… Solution
==============================================

Introduction
------------

IMES is a server-based, multi-user music database & streamer. It employs couchdb for authentication and for serving its web frontend and music database to clients. Music is transcoded on-the-fly to MP3 and streamed via RTSP or HTTP.


Features
--------

- supported audio codecs/metadata: FLAC, MP3, MP4, Ogg Vorbis, ASF, Musepack
- changes to music collection are reflected instantly on the client side (via inotify)
- ReplayGain
- supported browsers: chrome/chromium (also mobile), firefox
- web notifications (chrome/chromum)
- cover art
- last.fm


Limitations / Known Issues
--------------------------

- access control is all-or-nothing (via couchdb)
- android devices do not like MP3 RTSP streams (HTTP streaming works, but has very high latency)
- playlist editing is limited to appending & deleting
- no libre.fm support (they don't seem to support the new track.scrobble API)


Requirements
------------

A Linux host with:

- sox
- python (2.7)
- python-mutagen
- python-inotifyx
- python-couchdb
- python-numpy
- python-yaml
- python-imaging (PIL)
- python-pylast
- python-cffi
- libmp3lame-dev (3.99)
- couchdb (tested with 1.20)
- (optional) a web server


Aggregates, Channels, Delegates, Devices and Users
--------------------------------------------------

An aggregate is an aggregation of devices and users (think: room). An aggregate plays one channel (or none).

A channel has a playlist and a paused state. A channel is playing, if the playlist is non-empty (and has not been played through till the end), the channel is not paused, if at least one user is listening (has an active browser session and is not on lockout) and at least one (non-muted) device is connected. Multiple aggregates can play the same music simultaneously by subscribing to the same channel.

A device is something that can play a music stream, i.e.: has one or more speakers attached and a network connection to the IMES backend. A device may be muted by a delegate. The device's streaming URLs are displayed in the Settings screen.

A delegate is an entity that may cause the music (on certain devices) to be muted, e.g. some VoIP telephones can be configured to fetch configurable URLs on incoming calls (and other events), which can be used to automatically (un)pause the music while a phone call is active.


Configuration
-------------

The configuration file (config.yaml) is a YAML document, example:

    media:
      - /home/user/music
    
    database:
      url: http://admin:secret@localhost:5984/
      name: imes
      origin: http://localhost:5984
    
    backend:
      bind_host: 127.0.0.1
      bind_port: 9997
      rtp_port: 9998
      public: http://127.0.0.1:9997
      public_rtsp: rtsp://127.0.0.1:9997
      public_delegate: http://127.0.0.1:9997
    
    scrobbler:
      lastfm:
        key: API_KEY
        secret: API_SECRET

- media: list of paths to scan for music files and monitor for changes
- database url: URL of you couchdb instance with admin credentials
- database name: name of the couchdb database to create & use
- database origin: value for the Access-Control-Allow-Origin CORS header to allow backend access from the frontend (which is served from couchdb and may thus have a different URL), multiple values can be separated with a comma (,)
- backend bind_host, bind_port: IP & port on which to bind the backend, the backend serves both HTTP & RTSP request
- backend bind_host, rtp_port: IP & port from which to send RTP data, RTCP port is rtp_port + 1
- backend public: URL that the frontend shall use for requests to the backend
- backend public_rtsp: URL that the frontend shall use for displaying RTSP URLs
- backend public_delegate: URL that the frontend shall use for displaying HTTP delegate URLs (and HTTP streaming URLs)
- scrobbler: API key & secret for last.fm
