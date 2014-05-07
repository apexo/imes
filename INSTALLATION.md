Installation
============

inotify
-------

IMES uses inotify to track changes of the media library. inotify required one "watch" per watched directory. For large media collections, the default limit is probably too low. The following command should yield a lower bound on the number of required watches:

    find /path_to_your_music_collection -type d | wc -l


The real watch limit should be higher than that. Maybe twice as high, and add some leeway for other processes – a good indication for that is the system default (which is 8192 on my system). The resulting number is then fed to sysctl:

    sysctl fs.inotify.max_user_watches=16384


To persist this setting across reboots, you may want to put the following (adjust based on your requirements) into a new file in /etc/sysctl.d, e.g. /etc/sysctl.d/imes:

    fs.inotify.max_user_watches = 16384


Debian Wheezy/Testing
---------------------

Most dependencies are available as native debian package. cffi is not, so we use virtualenv+pip to compile that ourselves.


install prerequisites:

    apt-get install --no-install-recommends python-virtualenv python-pip build-essential python2.7-dev libffi-dev libmp3lame-dev
    apt-get install --no-install-recommends python-pylast python-imaging python-yaml python-numpy python-couchdb python-inotifyx
    apt-get install git sox libsox-fmt-ffmpeg libsox-fmt-mp3


optional: create separate user

    mkdir /opt/imes
    adduser --system --disabled-password --no-create-home --shell /bin/bash --home /opt/imes imes
    chown imes /opt/imes
    cd /opt/imes
    su imes


setup virtualenv & install cffi

    virtualenv --system-site-packages pyenv
    pyenv/bin/pip install cffi


checkout

    git clone git://github.com/apexo/imes.git
    cd imes
    cp config.yaml.template config.yaml


edit configuration, then run:

    ../pyenv/bin/python imes.py


Debian Unstable/Sid
-------------------

As of 2013-04-12, python-cffi is actually included in Debian Unstable/Sid (http://bugs.debian.org/cgi-bin/bugreport.cgi?bug=700084). This simplifies installation a bit (untested, feedback appreciated):


install dependencies:

    apt-get install --no-install-recommends build-essential libmp3lame-dev python2.7
    apt-get install --no-install-recommends python-pylast python-imaging python-yaml python-numpy python-couchdb python-inotifyx python-cffi
    apt-get install git sox libsox-fmt-ffmpeg libsox-fmt-mp3


checkout

    git clone git://github.com/apexo/imes.git
    cd imes
    cp config.yaml.template config.yaml


edit configuration, then run:

    python2.7 imes.py
