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

![IMES Search Screen](https://apexo.de/data/imes_search.png "Search Screen")
![IMES Playlist Screen](https://apexo.de/data/imes_playlist.png "Playlist Screen")


Demo Installation
-----------------

A demo installation is running at (http://imes-demo.apexo.de/)[http://imes-demo.apexo.de/]. Four demo accounts user1, user2, user3, and user4 are available; password is the same as the user name. RTSP streaming is currently not available in the demo installation.


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
- python2.7
- python-mutagen
- python-inotifyx
- python-couchdb
- python-numpy
- python-yaml (pyyaml)
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

![IMES Settings Screen](https://apexo.de/data/imes_settings.png "Settings Screen")
![IMES Settings Screen - Expanded](https://apexo.de/data/imes_settings2.png "Settings Screen - Expanded")


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
- backend bind\_host, bind\_port: IP & port on which to bind the backend, the backend serves both HTTP & RTSP request
- backend bind\_host, rtp\_port: IP & port from which to send RTP data, RTCP port is rtp\_port + 1
- backend public: URL that the frontend shall use for requests to the backend
- backend public\_rtsp: URL that the frontend shall use for displaying RTSP URLs
- backend public\_delegate: URL that the frontend shall use for displaying HTTP delegate URLs (and HTTP streaming URLs)
- scrobbler: API key & secret for last.fm


### CouchDB ###

In order for CouchDB to handle user authentication you need to uncomment the WWW-Authenticate line in the [httpd] section and set require\_valid\_user in [couch\_httpd\_auth] to true (/etc/couchdb/local.ini).

    [httpd]
    WWW-Authenticate = Basic realm="my imes installation"

    [couch_httpd_auth]
    require_valid_user = true

/etc/couchdb/local.ini is also the place to create an admin user for the IMES backend.

    [admins]
    admin_name = admin_password

upon restart, CouchDB should automatically encrypt the password.

For convenience, you may want to automatically redirect the user to the IMES frontend and serve a favicon (in the redirect handler, "imes" should be replaced by the name of the database that IMES uses, if you changed it):

    [httpd_global_handlers]
    / = {couch_httpd, send_redirect, "/imes/app/index.html"}
    favicon.ico = {couch_httpd_misc_handlers, handle_favicon_req, "PATH_TO_ÍMES/res"}

### SSL ###

Since CouchDB only does Basic HTTP Authentication, you really should put a reverse proxy in front of CouchDB for SSL. The reverse proxy might also be useful to unify the CouchDB and the IMES HTTP backend (change public and public\_delegate URLs accordingly, RTSP will probably be not that simple). A common URL for database and backend alleviates the need for proper CORS configuration (database origin configuration value).

An example nginx configuration might look like this:

    server {
            listen          443;
            listen          [::]:443 default ipv6only=on; ## listen for ipv6
    
            ssl             on;
            ssl_certificate /etc/ssl/imes.domain.crt;
            ssl_certificate_key /etc/ssl/private/imes.domain.key;
    
            server_name     imes.domain;
            proxy_read_timeout 120s;
    
            location /imes {
                    proxy_pass http://127.0.0.1:5984/imes;
            }
            location /_users {
                    proxy_pass http://127.0.0.1:5984/_users;
            }
            location /_session {
                    proxy_pass http://127.0.0.1:5984/_session;
            }
            location /b {
                    rewrite /b/(.*) /$1 break;
                    proxy_pass http://127.0.0.1:9997;
            }
            location /favicon.ico {
                    alias /var/www/imes-favicon.ico;
            }
            location / {
                    rewrite ^(.*) https://imes.domain/imes/app/index.html permanent;
            }
    }

This configuration proxies the /imes, /\_users and /\_session URLs to CouchDB and /b to the backend, a matching backend configuration could look like:

    backend:
      bind_host: 127.0.0.1
      bind_port: 9997
      rtp_port: 9998
      public: https://imes.domain/b
      public_rtsp: rtsp://127.0.0.1:9997
      public_delegate: https://imes.domain/b
