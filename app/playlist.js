var PlaylistDisplay = {};
PlaylistDisplay.createSingleTrackButtons = PlaylistDisplay.createAlbumTrackButtons = function(target) {
	createButton(target, "info", "Query track information.");
	createButton(target, "play", "Play this track now.");
	createButton(target, "remove", "Remove this track from the playlist.");
}

PlaylistDisplay.createAlbumButtons = function(target) {
	createButton(target, "remove", "Remove this album from the playlist.");
}

PlaylistDisplay.handleAlbumTrack = PlaylistDisplay.handleSingleTrack = function(button, target, event) {
	if (button === "play") {
		playNow(target);
	} else if (button === "remove") {
		var plkey = target.dataset.key;
		deleteFromPlaylist(plkey_plid(plkey), [plkey_idx(plkey)]);
	} else if (button === "info") {
		displayTrackInfo(target.dataset.id, event);
	}
}

PlaylistDisplay.handleAlbum = function(button, target) {
	var tracks = target.parentElement.querySelectorAll(".album-track");
	if (button === "play") {
		playNow(tracks[0]);
	} else if (button === "remove") {
		var plids = {};
		for (var i = 0; i < tracks.length; i++) {
			var plkey = tracks[i].dataset.key, plid = plkey_plid(plkey), idx = plkey_idx(plkey);
			if (!plids.hasOwnProperty(plid)) {
				plids[plid] = [];
			}
			plids[plid].push(idx);
		}
		for (var plid in plids) {
			if (plids.hasOwnProperty(plid)) {
				deleteFromPlaylist(plid, plids[plid]);
			}
		}
	}
}

PlaylistDisplay.handleSearch = function(value) {
	setSearchTerms(value);
	navigation.triggerNavigation(document.getElementById("nav-search"));
}

function Playlist(target, subscription, navigation, playlistSelector, userStatus) {
	this.target = target;
	this.subscription = subscription;
	this.navigation = navigation;
	this.playlistSelector = playlistSelector;
	this.userStatus = userStatus;

	this.scrollParent = document.body;

	this.forwardPlaceHolder = document.createElement("div");
	this.forwardPlaceHolder.style.visibility = "hidden";

	this.backwardPlaceHolder = document.createElement("div");
	this.backwardPlaceHolder.style.visibility = "hidden";

	window.addEventListener("resize", this.resize.bind(this));
	window.addEventListener("scroll", this.fetchSome.bind(this));
	this.navigation.onnavigate.addListener(this.navigationCb, this);
	this.subscription.onchange.addListener(this.changesCb, this);
	this.userStatus.onupdate.addListener(this.statusUpdate, this);
	this.userStatus.oninvalidate.addListener(this.statusInvalidate, this);
	this.playlistSelector.onplaylistselect.addListener(this.update, this);
	this.subscription.onready.addListener(this.subscriptionReady, this);

	this.state = "pending";

	this.resize();

	if (this.subscription.ready) {
		this.subscriptionReady();
	}
	if (this.userStatus.status) {
		this.statusUpdate(this.userStatus.status);
	}
}

Playlist.prototype.resize = function() {
	this.forwardPlaceHolder.style.height = Math.floor(this.scrollParent.parentElement.clientHeight / 2) + "px";
	this.backwardPlaceHolder.style.height = Math.floor(this.scrollParent.parentElement.clientHeight / 2) + "px";
	this.fetchSome();
}

Playlist.prototype.navigationCb = function(target) {
	if (target.id === "nav-playlist") {
		var cp = this.target.getElementsByClassName("currently-playing");
		if (cp && cp.length) {
			cp[0].scrollIntoViewIfNeeded();
		}

		this.fetchSome();
	}
}

Playlist.prototype.subscriptionReady = function() {
	if (!this.userStatus.status) {
		return;
	}
	if (this.state === "pending") {
		this.state = "ready";
		this.update(this.playlistSelector, this.playlistSelector.targetPlaylist);
	}
}

Playlist.prototype.initProgressBar = function(el) {
	var pb = document.createElement("div");
	pb.classList.add("progress-bar");
	pb.appendChild(document.createTextNode("\xa0"))

	el.classList.add("currently-playing");
	el.appendChild(pb);

	var update = this.updateProgressBar.bind(this, pb);
	update();

	RAF.register("playlist", update);
	el.scrollIntoViewIfNeeded();
}

Playlist.prototype.updateProgressBar = function(pb) {
	var color, now, t0, pos, s = this.userStatus.status;

	if (s.currentlyPlaying) {
		if (s.currentlyPlaying.t0 === undefined) {
			s.currentlyPlaying.t0 = Date.now();
		}
		t0 = s.currentlyPlaying.t0;
		if (s.paused) {
			color = "blue";
			now = t0;
		} else if (s.autoPaused) {
			color = "yellow";
			now = t0;
		} else {
			color = "";
			now = Date.now();
		}
		pos = s.currentlyPlaying;
	} else {
		now = t0 = Date.now();
		color = "black";
		pos = s.savedPosition;
	}

	var
		el = pb.parentElement,
		length = el.dataset.length,
		total = length ? Math.floor(length * 44100 + 0.5) : 0,
		samplePos = pos.pos + Math.floor((now - t0) * 44.1 + 0.5);

	el.getElementsByClassName("length-indicator")[0].firstChild.textContent = formatLength(length, samplePos / 44100);

	if (samplePos >= total) {
		pb.style.backgroundColor = "red";
		pb.style.width = "100%";
	} else {
		pb.style.backgroundColor = color;
		pb.style.width = Math.min(samplePos * 100 / total, 100) + "%";
	}
}

Playlist.prototype.removeProgressBar = function(element) {
	element.removeChild(element.getElementsByClassName("progress-bar")[0]);
	element.getElementsByClassName("length-indicator")[0].firstChild.textContent = formatLength(element.dataset.length);
	element.classList.remove("currently-playing");
	RAF.unregister("playlist");
}

Playlist.prototype.statusInvalidate = function() {
	this.state = "pending";
}

Playlist.prototype.statusUpdate = function(s) {
	if (!this.subscription.ready) {
		return;
	}
	if (this.state === "pending") {
		this.state = "ready";
		this.update(this.playlistSelector, this.playlistSelector.targetPlaylist);
	}

	var cp = this.target.getElementsByClassName("currently-playing");
	var pos = this.getPosition();

	if (pos.plid) {
		pos.t0 = Date.now();
	}

	var found = false, key = plkey(pos.plid, pos.idx);

	for (var i = 0; i < cp.length; i++) {
		if (cp[i].dataset.key === key) {
			found = true;
		} else {
			this.removeProgressBar(cp[i]);
			i -= 1;
		}
	}

	if (!found) {
		var entry = this.playlist.lookupGte(key);

		if (entry && entry.key == key) {
			this.initProgressBar(entry.value);
		} else if (key !== plkey("", 0) && isVisible(this.target) && pos.fid) {
			console.log("not found:", key, " - reloading playlist");
			this.update(this.playlistSelector, this.playlistSelector.targetPlaylist);
		}
	}
}

Playlist.prototype.getPosition = function() {
	var defaultPosition = {plid: "", idx: 0, pos: 0};
	if (this.state === "ready" && this.playlistSelector.targetPlaylist === "playlist:channel:" + this.userStatus.status.channel) {
		if (this.userStatus.status.currentlyPlaying) {
			return this.userStatus.status.currentlyPlaying;
		}
		return this.userStatus.status.savedPosition || defaultPosition;
	} else {
		return defaultPosition;
	}
}

Playlist.prototype.update = function(pls, targetPlaylist) {
	if (this.state === "pending") {
		return;
	}

	if (this.forward) {
		this.forward.abort();
	}
	if (this.backward) {
		this.backward.abort();
	}

	this.playlist = new avltree();
	this.target.innerHTML = "";

	delete this.subscription.args.channel;
	delete this.subscription.args.playlist;

	if (!targetPlaylist) {
		this.forwardState = this.backwardState = "done";
		this.subscription.updateArguments();
		return;
	}

	subscription.args.playlist = targetPlaylist.substring(9); // playlist:
	if (!pls.userPlaylist) {
		this.subscription.args.channel = targetPlaylist.substring(17); // playlist:channel:
	}
	this.subscription.updateArguments();

	this.forwardState = this.backwardState = "paused";

	this.target.appendChild(this.backwardPlaceHolder);
	this.target.appendChild(this.forwardPlaceHolder);

	var pos = this.getPosition();
	var view = new PlaylistView(playlistSelector.targetPlaylist, pos.plid, pos.idx);
	this.forward = view.getForwardIterator();
	this.backward = view.getReverseIterator();
	this.forwardLast = this.backwardLast = null;

	this.fetchSome();
}

Playlist.prototype.remove = function(plid) {
	var items = [];
	this.playlist.getRange(plid_range_low(plid), plid_range_high(plid), items);
	for (var i = 0; i < items.length; i++) {
		this.playlist = this.playlist.remove(items[i].dataset.key);
		deleteTrack(items[i]);
		this.fetchSome();
	}
}

Playlist.prototype.onupdate = function(doc) {
	var plid = doc._id;
	for (var i = 0; i < doc.items.length; i++) {
		var id = doc.items[i], key = plkey(plid, i);
		if (!id) {
			var entry = this.playlist.lookupGte(key);
			if (entry.key === key) {
				this.playlist = this.playlist.remove(entry.key);
				deleteTrack(entry.value);
				this.fetchSome();
			}
		} else {
			if (!this.playlist.count || key > this.playlist.max().key) {
				this.resumeForward();
			}
		}
	}
}

Playlist.prototype.add = function(item, last, insertBefore, p) {
	var pos = this.getPosition(), plid = plkey(pos.plid, pos.idx);

	if (item.value._deleted) {
		// file associated with playlist entry does not exist (anymore)
		var t = formatErrorTrack(item.value._id, PlaylistDisplay);
		t.dataset.key = item.key;
		this.playlist = this.playlist.insert(item.key, t);
		if (item.key === plid) {
			this.initProgressBar(t);
		}
		this.target.insertBefore(t, insertBefore);
		return {};
	}

	var key = albumKey(item.value), el;
	if (last && last.key && last.key === key) {
		if (!last.container) {
			last.container = makeAlbum(last.info, key, PlaylistDisplay);
			this.target.insertBefore(last.container, last.track);
			this.target.removeChild(last.track);
			el = formatAlbumTrack(last.info, last.container.getElementsByClassName("album-tracklist")[0], 0, PlaylistDisplay);
			el.dataset.key = last.track.dataset.key;
			this.playlist = this.playlist.insert(last.track.dataset.key, el);
			if (last.track.dataset.key === plid) {
				this.initProgressBar(el);
			}
			last.track = last.info = null;
		}
		el = formatAlbumTrack(item.value, last.container.getElementsByClassName("album-tracklist")[0], p, PlaylistDisplay);
		el.dataset.key = item.key;
		this.playlist = this.playlist.insert(item.key, el);
		if (item.key === plid) {
			this.initProgressBar(el);
		}
		return last;
	}
	last = {
		track: formatSingleTrack(item.value, PlaylistDisplay),
		info: item.value,
		container: null,
		key: key
	};
	last.track.dataset.key = item.key;
	this.playlist = this.playlist.insert(item.key, last.track);
	if (item.key === plid) {
		this.initProgressBar(last.track);
	}
	this.target.insertBefore(last.track, insertBefore);
	return last;
}

Playlist.prototype.addForward = function(items, done) {
	for (var i = 0; i < items.length; i++) {
		this.forwardLast = this.add(items[i], this.forwardLast, this.forwardPlaceHolder, 1);
		if (!this.backwardLast) {
			this.backwardLast = this.forwardLast;
		}
	}

	if (done) {
		this.target.removeChild(this.forwardPlaceHolder);
		this.forwardState = "done";
	} else {
		this.forwardState = "paused";
	}
	this.fetchSome();
}

Playlist.prototype.addBackward = function(items, done) {
	var oldHeight = this.target.clientHeight;

	for (var i = 0; i < items.length; i++) {
		this.backwardLast = this.add(items[i], this.backwardLast, this.backwardPlaceHolder.nextElementSibling, -1);
		if (!this.forwardLast) {
			this.forwardLast = this.backwardLast;
		}
	}

	if (done) {
		this.target.removeChild(this.backwardPlaceHolder);
		this.backwardState = "done";
	} else {
		this.backwardState = "paused";
	}
	var newHeight = this.target.clientHeight;
	this.scrollParent.scrollTop += newHeight - oldHeight;
	this.scrollParent.parentElement.scrollTop += newHeight - oldHeight;
	this.fetchSome();
}

Playlist.prototype.fetchSome = function() {
	if (this.state !== "ready") {
		return;
	}
	if (this.forwardState === "paused" && isVisible2(this.forwardPlaceHolder)) {
		this.forwardState = "loading";
		this.forward.fetch(this.addForward.bind(this), 10);
	}
	if (this.backwardState === "paused" && isVisible2(this.backwardPlaceHolder)) {
		this.backwardState = "loading";
		this.backward.fetch(this.addBackward.bind(this), 10);
	}
}

Playlist.prototype.resumeForward = function() {
	if (this.forwardState === "done") {
		this.target.appendChild(this.forwardPlaceHolder);
		this.forwardState = "paused";
	}
	this.forward.done = false;
	this.fetchSome();
}

Playlist.prototype.changesCb = function(changes) {
	for (var i = 0; i < changes.length; i++) {
		var change = changes[i];
		if (change.deleted) {
			this.remove(change.id);
		} else if (change.doc.type === "playlist") {
			this.onupdate(change.doc);
		}
	}
}
