var SearchResult = {};
SearchResult.createSingleTrackButtons = SearchResult.createAlbumButtons = SearchResult.createAlbumTrackButtons = function(target) {
	createButton(target, "play", "Add this album/track to the target playlist.");
}

SearchResult.handleAlbumTrack = SearchResult.handleSingleTrack = function(button, target) {
	if (button !== "play") {return alert(button);};
	enqueueTracks([target.dataset.id]);
}

SearchResult.handleAlbum = function(button, target) {
	if (button !== "play") {return alert(button);};
	var ids = [];
	var tracks = target.parentElement.querySelectorAll(".album-track");
	for (var i = 0; i < tracks.length; i++) {
		var t = tracks[i];
		ids.push(t.dataset.id);
	}
	enqueueTracks(ids);
}

SearchResult.handleSearch = function(value) {
	setSearchTerms(value);
}

function Search(target, subscription, navigation) {
	this.token = 0;
	this.target = target;
	this.subscription = subscription;
	this.navigation = navigation;
	this.remote = new Remote();
	this.pageSize = 20;
	this.scrollParent = document.body;
	this.placeHolder = document.createElement("div");
	this.placeHolder.style.visibility = "hidden";
	this.state = "preparing";
	this.view = null;
	this.albumCache = {};
	this.idCache = {};

	window.addEventListener("resize", this.resize.bind(this));
	window.addEventListener("scroll", this.fetchSome.bind(this));

	this.navigation.onnavigate.addListener(this.fetchSome, this);

	if (this.subscription.ready) {
		this.readyCb();
	} else {
		this.subscription.onready.addListener(this.readyCb, this);
	}
	this.subscription.onchange.addListener(this.changesCb, this);
	this.resize();
}

Search.prototype.resize = function() {
	this.placeHolder.style.height = Math.floor(this.scrollParent.parentElement.clientHeight / 2) + "px";
	this.fetchSome();
}

Search.prototype.update = function(terms) {
	if (this.view && this.state === "loading") {
		this.view.abort();
	}

	this.target.innerHTML = "";
	this.target.appendChild(this.placeHolder);
	this.state = this.state === "preparing" ? "preparing" : "paused";
	this.view = this.remote.getView(terms);
	this.albumCache = {};
	this.idCache = {};

	this.fetchSome();
}

Search.prototype.remove = function(id) {
	var track = this.idCache[id];
	if (track) {
		delete this.idCache[id];
		deleteTrack(track, this.albumCache);
	}
}

Search.prototype.add = function(info) {
	if (this.idCache.hasOwnProperty(info._id) || info.type !== "file") {
		return;
	}

	var key = albumKey(info);
	var cachedAlbum = key ? this.albumCache[key] : null;

	if (!cachedAlbum) {
		var track = formatSingleTrack(info, SearchResult);
		this.idCache[info._id] = track;

		if (key) {
			this.albumCache[key] = {track: track, info: info, container: null}
		}
		this.target.insertBefore(track, this.state === "done" ? null : this.placeHolder);
		return;
	}

	var tracklist;

	if (!cachedAlbum.container) {
		cachedAlbum.container = makeAlbum(info, key, SearchResult);
		tracklist = cachedAlbum.container.getElementsByClassName("album-tracklist")[0];

		this.idCache[cachedAlbum.info._id] = formatAlbumTrack(cachedAlbum.info, tracklist, 0, SearchResult);
		this.target.removeChild(cachedAlbum.track);
		cachedAlbum.track = cachedAlbum.info = null;
	} else {
		addCover(cachedAlbum.container, info);
		this.target.removeChild(cachedAlbum.container);
		tracklist = cachedAlbum.container.getElementsByClassName("album-tracklist")[0];
	}


	this.idCache[info._id] = formatAlbumTrack(info, tracklist, 0, SearchResult);
	this.target.insertBefore(cachedAlbum.container, this.state === "done" ? null : this.placeHolder);
}

Search.prototype.viewCb = function(ids, done) {
	for (var i = 0; i < ids.length; i++) {
		this.add(ids[i].doc);
	}
	if (done) {
		this.target.removeChild(this.placeHolder);
		this.state = "done";
	} else if (isVisible(this.placeHolder, this.scrollParent)) {
		this.view.fetch(this.viewCb.bind(this), this.pageSize);
	} else {
		this.state = "paused";
	}
}

Search.prototype.fetchSome = function() {
	if (this.view && this.state === "paused") {
		if (isVisible(this.placeHolder, this.scrollParent)) {
			this.state = "loading";
			this.view.fetch(this.viewCb.bind(this), this.pageSize);
		}
	}
}

Search.prototype.readyCb = function() {
	if (this.state === "preparing") {
		this.state = "paused";
		this.fetchSome()
	}
}

Search.prototype.changesCb = function(changes) {
	for (var i = 0; i < changes.length; i++) {
		var change = changes[i];
		if (change.deleted) {
			this.remove(change.id);
		} else if (this.view.filter(change)) {
			this.remove(change.id);
			this.add(change.doc);
		}
	}

	this.fetchSome();
}
