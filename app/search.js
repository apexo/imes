var SearchResult = {};
SearchResult.createAlbumButtons = function(target) {
	createButton(target, "play", "Add this album/track to the target playlist.");
}

SearchResult.createSingleTrackButtons = SearchResult.createAlbumTrackButtons = function(target) {
	createButton(target, "info", "Query track information.");
	createButton(target, "play", "Add this album/track to the target playlist.");
}

SearchResult.handleAlbumTrack = SearchResult.handleSingleTrack = function(button, target, event) {
	if (button === "play") {
		enqueueTracks([target.dataset.id]);
	} else if (button === "info") {
		displayTrackInfo(target.dataset.id, event);
	}
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
	this.albumsLoading = {};

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

	for (var k in this.albumsLoading) {
		if (this.albumsLoading.hasOwnProperty(k)) {
			ajax_abort(this.albumsLoading[k]);
		}
	}
	this.albumsLoading = {};

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
			track.dataset.key = key;
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

		this.loadAlbum(key);
	} else {
		addCover(cachedAlbum.container, info);
		this.target.removeChild(cachedAlbum.container);
		tracklist = cachedAlbum.container.getElementsByClassName("album-tracklist")[0];
	}


	this.idCache[info._id] = formatAlbumTrack(info, tracklist, 0, SearchResult);
	this.target.insertBefore(cachedAlbum.container, this.state === "done" ? null : this.placeHolder);
}

Search.prototype.loadAlbum = function(key) {
	if (this.albumsLoading.hasOwnProperty(key)) {
		console.log("album already loading?", key);
		return;
	}

	var tokens = key.split("\x00");
	if (tokens.length != 3) {
		console.log("this supposed to be an album key?", tokens);
		return;
	}
	var path = tokens[0], album = tokens[1], discnumber = parseInt(tokens[2]);

	var url = DB_URL + DB_NAME + "/_design/file/_view/path2?include_docs=true";
	url += "&key=" + encodeURIComponent(JSON.stringify([path, album, discnumber]));

	this.albumsLoading[key] = ajax_get(url, this.albumCb.bind(this, key));
}

Search.prototype.albumCb = function(key, result) {
	if (!this.albumsLoading.hasOwnProperty(key)) {
		return;
	}

	delete this.albumsLoading[key];

	for (var i = 0; i < result.rows.length; i++) {
		if (this.view.filter(result.rows[i])) {
			this.add(result.rows[i].doc);
		}
	}
}

Search.prototype.viewCb = function(ids, done) {
	for (var i = 0; i < ids.length; i++) {
		this.add(ids[i].doc);
	}
	if (done) {
		this.target.removeChild(this.placeHolder);
		this.state = "done";
	} else if (isVisible2(this.placeHolder)) {
		this.view.fetch(this.viewCb.bind(this), this.pageSize);
	} else {
		this.state = "paused";
	}
}

Search.prototype.fetchSome = function() {
	if (this.view && this.state === "paused") {
		if (isVisible2(this.placeHolder)) {
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
