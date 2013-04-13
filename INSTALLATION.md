Installation
============

Debian Wheezy/Testing
---------------------

Most dependencies are available as native debian package. cffi is not, so we use virtualenv+pip to compile that ourselves.


install prerequisites:

    aptitude install --without-recommends python-virtualenv python-pip build-essential python2.7-dev libffi-dev libmp3lame-dev
    aptitude install --without-recommends python-pylast python-imaging python-yaml python-numpy python-couchdb python-inotifyx
    aptitude install git sox libsox-fmt-ffmpeg libsox-fmt-mp3


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
