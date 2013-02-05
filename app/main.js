var currentSearchToken = 0;
var currentPlaylistToken = 0;
var remote = null;
var subscription = null;
var playlist = new avltree();

var SearchResult = {};
SearchResult.createSingleTrackButtons = SearchResult.createAlbumButtons = SearchResult.createAlbumTrackButtons = function(target) {
	createButton(target, "play");
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

var Playlist = {};
Playlist.createSingleTrackButtons = Playlist.createAlbumButtons = Playlist.createAlbumTrackButtons = function(target) {
	createButton(target, "play");
	createButton(target, "remove");
}

Playlist.handleAlbumTrack = Playlist.handleSingleTrack = function(button, target) {
	if (button === "play") {
		playNow(target);
	} else if (button === "remove") {
		var plkey = target.dataset.key;
		deleteFromPlaylist(plkey_plid(plkey), [plkey_idx(plkey)]);
	}
}

Playlist.handleAlbum = function(button, target) {
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

Playlist.handleSearch = function(value) {
	// TODO: navigate to search results
	setSearchTerms(value);
}

function makeLink(data, target, cls, sep, instead) {
	var n = 0;
	if (data) {
		for (var j = 0; j < data.length; j++) {
			if (data[j]) {
				if (n) {
					target.appendChild(document.createTextNode(sep));
				}
				n += 1;
				var a = document.createElement("a");
				a.href = "";
				a.classList.add(cls);
				a.appendChild(document.createTextNode(data[j]));
				target.appendChild(a);
			}
		}
	}
	if (!n) {
		target.appendChild(document.createTextNode(instead));
	}
}

function artistLink(i, target) {
	makeLink(i.artist, target, "artist-link", ", ", "Unknown Artist");
}

function albumLink(i, target) {
	makeLink(i.album, target, "album-link", ", ", "Unknown Album");
}

function titleLink(i, target) {
	var instead = i.path.substring(i.path.lastIndexOf("/"));
	makeLink(i.title, target, "title-link", ", ", "Unknown Title [" + instead + "]");
}

function formatAlbumTrack(i, tracklist, position, btns) {
	var t, tracknumber;
	if (i.tracknumber !== undefined) {
		tracknumber = parseInt(i.tracknumber);
		if (isNaN(tracknumber)) {
			tracknumber = 0;
			t += i.tracknumber + ". ";
		} else if (tracknumber < 10) {
			t = "0" + tracknumber + ". ";
		} else {
			t = tracknumber + ". ";
		}
	} else {
		t = "??. ";
		tracknumber = 0;
	}

	var track = document.createElement("div");
	track.classList.add("album-track");
	track.dataset.id = i._id;
	track.dataset.tracknumber = tracknumber;
	track.dataset.length = i.info.length;
	track.appendChild(document.createTextNode(t));
	artistLink(i, track);
	track.appendChild(document.createTextNode(" - "));
	titleLink(i, track);
	track.appendChild(createLengthIndicator(formatLength(i.info.length)));

	var insertAfter;
	if (!position) {
		insertAfter = tracklist.lastElementChild;
		while (insertAfter && parseInt(insertAfter.dataset.tracknumber) > tracknumber) {
			insertAfter = insertAfter.previousElementSibling;
		}
	} else if (position < 0) {
		insertAfter = null;
	} else { // position > 0
		insertAfter = tracklist.lastElementChild;
	}
	tracklist.insertBefore(track, insertAfter ? insertAfter.nextElementSibling : tracklist.firstElementChild);

	btns.createAlbumTrackButtons(track);
	return track;
}

function formatSingleTrack(i, btns) {
	var t = document.createElement("div");
	t.classList.add("single-track");
	if (i.album && i.album.length) {
		t.appendChild(document.createTextNode("["));
		albumLink(i, t);
		t.appendChild(document.createTextNode("] "));
	}
	artistLink(i, t);
	t.appendChild(document.createTextNode(" - "));
	titleLink(i, t);
	t.appendChild(createLengthIndicator(formatLength(i.info.length)));
	t.dataset.id = i._id;
	t.dataset.length = i.info.length;

	btns.createSingleTrackButtons(t);
	return t;
}

function createButton(target, type) {
	var button = document.createElement("div");
	button.classList.add(type + "-button");
	button.appendChild(document.createTextNode("\xa0"));
	target.appendChild(button);
}

function formatAlbumName(i, target) {
	albumLink(i, target);
	if (i.discnumber && (i.discnumber > 1 || i.totaldiscs && i.totaldiscs > 1)) {
		target.appendChild(document.createTextNode(" [Disc " + i.discnumber + "]"));
	}
}

function scaledSize(img, max_width, max_height) {
	var ww = img.w * max_height;
	var hh = img.h * max_width;
	var nw, nh;
	if (ww < hh) {
		nw = (ww * 2 + img.h) / (2 * img.h);
		nh = max_height;
	} else if (hh < ww) {
		nw = max_width;
		nh = (hh * 2 + img.w) / (2 * img.w);
	} else {
		nw = max_width;
		nh = max_height;
	}
	return {w: nw, h: nh};
}

var THUMB_WIDTH = 160;
var THUMB_HEIGHT = 160;

function addCover(target, info) {
	if (!info.pictures || !info.pictures.length || target.querySelector(".album-cover")) {
		return;
	}
	var front = info.pictures.filter(function(p) {return p.type === 3;});
	var p = front.length ? front[0] : info.pictures[0];
	var formats = [];
	//console.log(p);
	for (var key in p.formats) {
		if (p.formats.hasOwnProperty(key)) {
			var f = p.formats[key];
			var ss = scaledSize(f, THUMB_WIDTH, THUMB_HEIGHT);
			formats.push([!(f.w > ss.w && f.h > ss.h), f.w*f.h, f, ss]);
		}
	}
	formats.sort();
	var f = formats[0][2];
	var ss = formats[0][3];
	//console.log(f);
	var cover = document.createElement("img");
	cover.classList.add("album-cover");
	cover.width = ss.w;
	cover.height = ss.h;
	cover.src = DB_URL + DB_NAME + "/" + p.key + "/" + f.f;
	target.insertBefore(cover, target.querySelector(".album-tracklist"));
}

function makeAlbum(i, key, btns) {
	var c = document.createElement("div");
	c.classList.add("album");
	var label = document.createElement("div");
	label.classList.add("album-label");
	formatAlbumName(i, label);
	c.appendChild(label);
	addCover(c, i);
	var tracklist = document.createElement("div");
	tracklist.classList.add("album-tracklist");
	c.appendChild(tracklist);
	c.dataset.key = key;

	btns.createAlbumButtons(label);
	return c;
}

function albumKey(i) {
	var album = i.album && i.album.length ? i.album[0] : "";
	var path = i.path.substring(0, i.path.lastIndexOf("/"));
	var disc = i.discnumber;

	return album ? path + '\x00' + album + '\x00' + (disc || 0) : null;
}

function deleteTrack(track, albumCache) {
	if (track.classList.contains("single-track")) {
		target.parentElement.removeChild(track);
	} else {
		var tracklist = track.parentElement;
		tracklist.removeChild(track);
		// TODO: maybe downgrade single remaining track to single-track?
		if (!tracklist.firstElementChild) {
			var albumContainer = tracklist.parentElement;
			if (albumCache) {
				delete albumCache[albumContainer.dataset.key];
			}
			albumContainer.parentElement.removeChild(albumContainer);
		}
	}
}

function doSearch(terms) {
	currentSearchToken += 1;
	var mySearchToken = currentSearchToken;

	var target = document.querySelector("#search-result");
	if (remote === null) {
		remote = new Remote(target);
	}
	var view = remote.getView(terms);
	var page = 10;
	var placeHolder = document.createElement("div");
	var scrollParent = document.body;
	var albumCache = {};
	var idCache = {};
	placeHolder.style.visibility = "hidden";
	placeHolder.style.height = Math.floor(scrollParent.parentElement.clientHeight / 2) + "px";

	target.innerHTML = "";
	target.appendChild(placeHolder);

	function remove(id) {
		var t = idCache[id];
		if (!idCache.hasOwnProperty(id)) {
			return;
		}
		delete idCache[id];
		deleteTrack(t, albumCache);
	}

	function add(i) {
		if (idCache.hasOwnProperty(i._id) || i.type !== "file") {
			return;
		}

		var key = albumKey(i);
		var cachedAlbum = key ? albumCache[key] : null;

		if (!cachedAlbum) {
			var t = formatSingleTrack(i, SearchResult);
			idCache[i._id] = t;

			if (key) {
				albumCache[key] = {t: t, i: i}
			}
			target.insertBefore(t, placeHolder);
			return;
		}

		var tracklist;

		if (!cachedAlbum.container) {
			cachedAlbum.container = makeAlbum(i, key, SearchResult);
			tracklist = cachedAlbum.container.getElementsByClassName("album-tracklist")[0];

			idCache[cachedAlbum.i._id] = formatAlbumTrack(cachedAlbum.i, tracklist, 0, SearchResult);
			target.removeChild(cachedAlbum.t);
			delete cachedAlbum.t;
			delete cachedAlbum.i;
		} else {
			addCover(cachedAlbum.container, i);
			target.removeChild(cachedAlbum.container);
			tracklist = cachedAlbum.container.getElementsByClassName("album-tracklist")[0];
		}


		idCache[i._id] = formatAlbumTrack(i, tracklist, 0, SearchResult);
		target.insertBefore(cachedAlbum.container, placeHolder);
	}

	var state = "paused";

	function resume(ids, done) {
		if (currentSearchToken !== mySearchToken) {
			return release();
		}
		for (var i = 0; i < ids.length; i++) {
			add(ids[i].doc);
		}
		if (done) {
			target.removeChild(placeHolder);
			placeHolder = null;
			window.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
			state = "done";
			return;
		}
		if (placeHolder.offsetTop - scrollParent.scrollTop < scrollParent.parentElement.clientHeight) {
			view.fetch(resume, page);
		} else {
			state = "paused";
		}
	}

	function update() {
		if (currentSearchToken !== mySearchToken) {
			return release();
		}

		if (state === "paused") {
			if (isVisible(placeHolder, scrollParent)) {
				state = "loading";
				view.fetch(resume, page);
			}
		}
	}

	function readyCb() {
		window.addEventListener("scroll", update);
		window.addEventListener("resize", update);
		update();
	}

	function changesCb(changes) {
		if (currentSearchToken !== mySearchToken) {
			return release();
		}

		for (var i = 0; i < changes.length; i++) {
			var change = changes[i];
			if (change.deleted) {
				remove(change.id);
			} else if (view.filter(change)) {
				remove(change.id);
				add(change.doc);
			}
		}

		update();
	}

	var manager = new EventManager();

	function release() {
		manager.destroy();
		window.removeEventListener("scroll", update);
		window.removeEventListener("resize", update);
	}

	if (subscription.ready) {
		readyCb();
	} else {
		manager.addListener(subscription.onready, readyCb, this);
	}
	manager.addListener(subscription.onchange, changesCb, this);
}

function deleteFromPlaylist(plid, idxs) {
	function ok() {
	}
	function error() {
		console.log("deletion failed", arguments);
	}
	var url = DB_URL + DB_NAME + "/" + encodeURIComponent(plid);
	function doDelete(value) {
		value = JSON.parse(value);
		for (var i = 0; i < idxs.length; i++) {
			value.items[idxs[i]] = null;
		}
		var not_empty = false;
		for (var i = 0; i < value.items.length; i++) {
			if (value.items[i]) {
				not_empty = true;
				break;
			}
		}
		if (not_empty) {
			ajax_post(url, value, ok, error, "PUT");
		} else {
			ajax_post(url + "?rev=" + value._rev, null, ok, error, "DELETE");
		}
	}
	ajax_get(url, doDelete);
}

function enqueueTracks(ids) {
	if (!targetPlaylist) {
		return alert("You must select a playlist first.");
	}
	var
		tpl = targetPlaylist,
		date = new Date().toISOString().replace(/[-:.TZ]/g, ""),
		rnd = Math.floor(Math.random() * 4294967296).toString(16);
	while (rnd.length < 8) {
		rnd = "0" + rnd;
	}
	var id = encodeURIComponent(tpl + "/" + date + "/" + rnd);
	ajax_post(DB_URL + DB_NAME + "/" + id, {
		"type": "playlist",
		"items": ids
	}, function() {}, null, "PUT");
}

function setSearchTerms(terms, source) {
	if (source !== "location") {
		document.location.href = "#" + encodeURI(terms);
	}
	if (source !== "user") {
		document.querySelector("#search-terms").value = terms;
	}
	doSearch(terms);
}

var currentUserName = null;
var currentUserAuthToken = null;
var currentStatus = null;
var currentChannel = null;
var targetPlaylist = null;

function queryUser() {
	ajax_get(DB_URL + "_session", function(result) {
		var userInfo = JSON.parse(result);
		console.log(userInfo);
		if (!userInfo.userCtx || !userInfo.userCtx.name) {
			alert("could not retrieve user info");
			return;
		}

		currentUserName = userInfo.userCtx.name;

		ajax_get(DB_URL + "_users/org.couchdb.user:" + currentUserName, function(result) {
			var userInfo = JSON.parse(result);
			console.log(userInfo);

			if (!userInfo.imes || !userInfo.imes.authToken) {
				alert("could not retrieve auth token");
				return;
			}
			currentUserAuthToken = userInfo.imes.authToken;

			queryStatus();
		});
	});
}

function updatePlaylists() {
	var
		base = "playlist:user:" + currentUserName,
		vp = new ViewProxy(DB_URL + DB_NAME + "/_all_docs", base + "/", base + "/ZZZZZZZZ");
	vp.fetch(function(data) {
		console.log(data);
		var target = document.querySelector("#playlist-select select");
		while (target.firstElementChild) {
			target.removeChild(target.firstElementChild);
		}
		var cpl = document.createElement("option");
		cpl.setAttribute("value", "playlist:channel:" + currentChannel);
		cpl.appendChild(document.createTextNode("[Channel " + currentChannel + "]"));
		target.appendChild(cpl);

		for (var i = 0; i < data.length; i++) {
			var pl = document.createElement("option");
			pl.setAttribute("value", "playlist:user:" + currentUserName + "/" + data[i].id);
			pl.appendChild(document.createTextNode(data[i].name));
			target.appendChild(pl);
		}

		if (!targetPlaylist) {
			targetPlaylist = target.value;
		}
	});
}

function createProgressBar() {
	var pb = document.createElement("div");
	pb.classList.add("progress-bar");
	pb.appendChild(document.createTextNode("\xa0"))
	return pb;
}

function formatLength(length, pos) {
	pos = (pos !== undefined && pos !== null) ? formatLength(pos) : null;

	var minutes = Math.floor(length / 60);
	var seconds = Math.floor(length - minutes * 60 + 0.5);
	seconds = seconds.toString();
	if (seconds.length < 2) {
		seconds = "0" + seconds;
	}
	length = minutes.toString() + ":" + seconds;
	return pos ? pos + "\xa0/\xa0" + length : length;
}

function createLengthIndicator(text) {
	var result = document.createElement("div");
	result.appendChild(document.createTextNode(text));
	result.classList.add("length-indicator");
	return result;
}

function updateProgressBar(pb, offset, length, t0) {
	var
		total = length ? Math.floor(length * 44100 + 0.5) : 0,
		pos = offset + Math.floor((Date.now() - t0) * 44.1 + 0.5);

	pb.parentElement.getElementsByClassName("length-indicator")[0].firstChild.textContent = formatLength(length, pos / 44100);

	if (pos >= total) {
		pb.style.backgroundColor = "red";
		pb.style.width = "100%";
	} else {
		pb.style.width = Math.min(pos * 100 / total, 100) + "%";
	}
}

function initProgressBar(el) {
	var pb = createProgressBar();
	el.classList.add("currently-playing");
	el.appendChild(pb);
	updateProgressBar(pb, currentStatus.currentlyPlaying.pos, el.dataset.length, currentStatus.currentlyPlaying.t0);

	function update() {
		updateProgressBar(pb, currentStatus.currentlyPlaying.pos, el.dataset.length, currentStatus.currentlyPlaying.t0);
	}

	RAF.register("playlist", update);
	el.scrollIntoViewIfNeeded();
}

function removeProgressBar(element) {
	element.removeChild(element.getElementsByClassName("progress-bar")[0]);
	element.getElementsByClassName("length-indicator")[0].firstChild.textContent = formatLength(element.dataset.length);
	element.classList.remove("currently-playing");
	RAF.unregister("playlist");
}

var statusUpdatePending = false;
var statusUpdateScheduled = false;

function doScheduledStatusUpdate() {
	statusUpdateScheduled = false;
	queryStatus();
}

function scheduleStatusUpdate(timeout) {
	if (statusUpdateScheduled) {
		return;
	}
	statusUpdateScheduled = true;

	setTimeout(doScheduledStatusUpdate, timeout);
}

function queryStatus() {
	if (statusUpdatePending) {
		return;
	}
	statusUpdatePending = true;

	ajax_get(BACKEND + "user/" + currentUserName + "/" + currentUserAuthToken + "/status", function(result) {
		statusUpdatePending = false;

		var s = JSON.parse(result);

		currentStatus = s;

		if (s.channel !== currentChannel) {
			currentChannel = s.channel;
			subscription.args.channel = s.channel;
			updatePlaylists();
			updatePlaylist();
		}

		//var target = document.querySelector("#playlist-select select");
		var target = document.querySelector("#playlist");
		var cp = target.getElementsByClassName("currently-playing")

		if (!s.currentlyPlaying) {
			for (var i = 0; i < cp.length; i++) {
				removeProgressBar(cp[i]);
				i -= 1;
			}
		} else {
			s.currentlyPlaying.t0 = Date.now();
			var found = false;
			var key = plkey(s.currentlyPlaying.plid, s.currentlyPlaying.idx);
			var progressBar;
			for (var i = 0; i < cp.length; i++) {
				if (cp[i].dataset.key === key) {
					found = true;
					progressBar = cp[i].getElementsByClassName("progress-bar")[0];
				} else {
					removeProgressBar(cp[i]);
					i -= 1;
				}
			}
			cp = null;

			var entry = playlist.lookupGte(key);
			var el = entry && entry.key === key ? entry.value : null;

			if (!found && el) {
				progressBar = initProgressBar(el);
			}
		}

		scheduleStatusUpdate(5000);
	}, function() {
		statusUpdatePending = false;

		scheduleStatusUpdate(30000);
	});
}

function isVisible(element, within) {
	if (element.offsetTop + element.clientHeight - within.scrollTop <= 0) {
		return false;
	}
	if (element.offsetTop - within.scrollTop >= within.parentElement.clientHeight) {
		return false;
	}
	if (element.style.display === "none") {
		return false;
	}
	element = element.parentElement;
	while (element) {
		if (element.style.display === "none") {
			return false;
		}
		element = element.parentElement;
	}
	return true;
}

function updatePlaylist() {
	currentPlaylistToken += 1;
	var myToken = currentPlaylistToken;
	playlist = new avltree();

	var target = document.querySelector("#playlist");
	target.innerHTML = "";
	if (!targetPlaylist) {
		return;
	}

	subscription.args.playlist = targetPlaylist.substring(9);
	subscription.updateArguments();

	var plid, idx;
	if (targetPlaylist === "playlist:channel:" + currentStatus.channel && currentStatus.currentlyPlaying) {
		plid = currentStatus.currentlyPlaying.plid;
		idx = currentStatus.currentlyPlaying.idx;
	} else {
		plid = targetPlaylist + "/";
		idx = 0;
	}

	var forwardPlaceHolder = document.createElement("div");
	var backwardPlaceHolder = document.createElement("div");
	var view = new PlaylistView(targetPlaylist, plid, idx);
	forwardPlaceHolder.style.visibility = "hidden";
	backwardPlaceHolder.style.visibility = "hidden";
	var scrollParent = document.body;
	forwardPlaceHolder.style.height = Math.floor(scrollParent.parentElement.clientHeight / 2) + "px";
	backwardPlaceHolder.style.height = Math.floor(scrollParent.parentElement.clientHeight / 2) + "px";

	target.innerHTML = "";
	target.appendChild(backwardPlaceHolder);
	target.appendChild(forwardPlaceHolder);

	var forward = view.getForwardIterator();
	var backward = view.getReverseIterator();
	var forwardActive = false, backwardActive = false;
	var forwardDone = false, backwardDone = false;
	var forwardLast = null, backwardLast = null;

	function remove(plid) {
		var items = [];
		playlist.getRange(plid_range_low(plid), plid_range_high(plid), items);
		for (var i = 0; i < items.length; i++) {
			playlist = playlist.remove(items[i].dataset.key);
			deleteTrack(items[i]);
		}
	}

	function onupdate(doc) {
		var plid = doc._id;
		for (var i = 0; i < doc.items.length; i++) {
			var id = doc.items[i], key = plkey(plid, i);
			if (!id) {
				var entry = playlist.lookupGte(key);
				if (entry.key === key) {
					playlist = playlist.remove(entry.key);
					deleteTrack(entry.value);
				}
			} else {
				if (!playlist.count || key > playlist.max().key) {
					resumeForward();
				}
			}
		}
	}

	function add(item, last, insertBefore, p) {
		var key = albumKey(item.value), el;
		var plid = currentStatus && currentStatus.currentlyPlaying ? plkey(currentStatus.currentlyPlaying.plid, currentStatus.currentlyPlaying.idx) : "";
		if (last && last.key && last.key === key) {
			if (!last.container) {
				last.container = makeAlbum(last.i, key, Playlist);
				target.insertBefore(last.container, last.t);
				target.removeChild(last.t);
				el = formatAlbumTrack(last.i, last.container.getElementsByClassName("album-tracklist")[0], 0, Playlist);
				el.dataset.key = last.t.dataset.key;
				playlist = playlist.insert(last.t.dataset.key, el);
				if (last.t.dataset.key === plid) {
					initProgressBar(el);
				}
				delete last.t;
				delete last.i;
			}
			el = formatAlbumTrack(item.value, last.container.getElementsByClassName("album-tracklist")[0], p, Playlist);
			el.dataset.key = item.key;
			playlist = playlist.insert(item.key, el);
			if (item.key === plid) {
				initProgressBar(el);
			}
			return last;
		}
		last = {
			t: formatSingleTrack(item.value, Playlist),
			i: item.value,
			key: key
		};
		last.t.dataset.key = item.key;
		playlist = playlist.insert(item.key, last.t);
		if (item.key === plid) {
			initProgressBar(last.t);
		}
		target.insertBefore(last.t, insertBefore);
		return last;
	}

	function addForward(items, done) {
		if (currentPlaylistToken !== myToken) {
			return release();
		}
		for (var i = 0; i < items.length; i++) {
			forwardLast = add(items[i], forwardLast, forwardPlaceHolder, 1);
			if (!backwardLast) {
				backwardLast = forwardLast;
			}
		}

		if (done) {
			target.removeChild(forwardPlaceHolder);
			forwardDone = true;
		} else {
			forwardActive = false;
		}
		update();
	}

	function addBackward(items, done) {
		if (currentPlaylistToken !== myToken) {
			return release();
		}
		var oldHeight = target.clientHeight;

		for (var i = 0; i < items.length; i++) {
			backwardLast = add(items[i], backwardLast, backwardPlaceHolder.nextElementSibling, -1);
			if (!forwardLast) {
				forwardLast = backwardLast;
			}
		}

		var newHeight = target.clientHeight;
		if (done) {
			target.removeChild(backwardPlaceHolder);
			backwardPlaceHolder = null;
			backwardDone = true;
		} else {
			backwardActive = false;
		}
		scrollParent.scrollTop += newHeight - oldHeight;
		update();
	}

	function update() {
		if (currentPlaylistToken !== myToken) {
			return release();
		}
		if (!forwardActive && isVisible(forwardPlaceHolder, scrollParent)) {
			forwardActive = true;
			forward.fetch(addForward, 10);
		}
		if (!backwardActive && isVisible(backwardPlaceHolder, scrollParent)) {
			backwardActive = true;
			backward.fetch(addBackward, 10);
		}
		if (forwardDone && backwardDone) {
			window.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		}
	}

	function resumeForward() {
		if (forwardDone && backwardDone) {
			window.addEventListener("scroll", update);
			window.addEventListener("resize", update);
		}
		if (forwardDone) {
			target.appendChild(forwardPlaceHolder);
			forwardDone = false;
			forwardActive = false;
		}
		forward.done = false;
		update();
	}

	var manager = new EventManager();

	function readyCb() {
		window.addEventListener("scroll", update);
		window.addEventListener("resize", update);
		update();
	}

	function release() {
		manager.destroy();
		window.removeEventListener("scroll", update);
		window.removeEventListener("resize", update);
	}

	function changesCb(changes) {
		if (currentPlaylistToken !== myToken) {
			return release();
		}

		for (var i = 0; i < changes.length; i++) {
			var change = changes[i];
			if (change.deleted) {
				remove(change.id);
			} else if (change.doc.type === "playlist") {
				onupdate(change.doc);
			}
		}

		update();
	}

	if (subscription.ready) {
		readyCb();
	} else {
		manager.addListener(subscription.onready, readyCb, this);
	}

	manager.addListener(subscription.onchange, changesCb, this);
}

function playNow(track) {
	var
		key = track.dataset.key,
		fid = track.dataset.id;

	ajax_post(BACKEND + "user/" + currentUserName + "/" + currentUserAuthToken + "/play", {
		"plid": plkey_plid(key),
		"idx": plkey_idx(key),
		"fid": fid
	}, function() {}, null, "POST");
}

function installClickHandler(target, handler) {
	target.addEventListener("click", function(event) {
		var target = event.target;
		var cl = target.classList;
		var button = null;
		if (cl.contains("play-button")) {
			button = "play";
		} else if (cl.contains("remove-button")) {
			button = "remove";
		}
		if (button) {
			target = target.parentElement;
			cl = target.classList;

			if (cl.contains("album-track")) {
				handler.handleAlbumTrack(button, target);
			} else if (cl.contains("album-label")) {
				handler.handleAlbum(button, target);
			} else if (cl.contains("single-track")) {
				handler.handleSingleTrack(button, target);
			} else {
				return;
			}
		} else if (cl.contains("album-link")) {
			handler.handleSearch("album2:" + encodeURI(target.firstChild.textContent));
		} else if (cl.contains("artist-link")) {
			handler.handleSearch("artist2:" + encodeURI(target.firstChild.textContent));
		} else if (cl.contains("title-link")) {
			handler.handleSearch("title2:" + encodeURI(target.firstChild.textContent));
		} else {
			return;
		}
		event.stopPropagation();
		event.preventDefault();
	}, false);
}

function onLoad() {
	if (subscription) {
		alert("???");
		return;
	}
	subscription = new Subscription({
		"include_docs": "true",
		"limit": 10,
		"filter": "file/all"
	})
	subscription.onchange.addListener(function(changes) {
		for (var i = 0; i < changes.length; i++) {
			var change = changes[i];
			if (!change.deleted && change.doc.type === "imes:channel") {
				console.log(change.doc);
				queryStatus();
			}
		}
	});

	setTimeout(function() {
		//new ViewportLayout(document.body, new VBoxLayout(document.body));
		new HeaderLayout(document.body);
		new VBoxLayout(document.querySelector("#header"));
		new HBoxLayout(document.querySelector("#top"));
		new HBoxLayout(document.querySelector("#top .filter"));
	
		layoutManager.layout();
		window.addEventListener("resize", function() {
			layoutManager.layout();
		});
		installClickHandler(document.getElementById("search-result"), SearchResult);
		installClickHandler(document.getElementById("playlist"), Playlist);

		document.querySelector("#playlist").addEventListener("click", function(event) {
			var target = event.target;
			var cl = target.classList;
			if (cl.contains("album-track")) {
				playNow(target);
			} else if (cl.contains("album-label")) {
				var tracks = target.parentElement.querySelectorAll(".album-track");
				playNow(tracks[0]);
			} else if (cl.contains("single-track")) {
				playNow(target);
			} else if (cl.contains("album-link")) {
				setSearchTerms("album2:" + encodeURI(target.firstChild.textContent));
				// TODO: navigate to search results
			} else if (cl.contains("artist-link")) {
				setSearchTerms("artist2:" + encodeURI(target.firstChild.textContent));
				// TODO: navigate to search results
			} else if (cl.contains("title-link")) {
				setSearchTerms("title2:" + encodeURI(target.firstChild.textContent));
				// TODO: navigate to search results
			} else {
				return;
			}
			event.stopPropagation();
			event.preventDefault();
		}, false);

		var navTargets = {}, navLinks = document.querySelectorAll("#nav a");
		for (var i = 0; i < navLinks.length; i++) {
			var navLink = navLinks[i];
			if (navLink.dataset.targets) {
				var targets = navLink.dataset.targets.split(",");
				for (var j = 0; j < targets.length; j++) {
					navTargets[targets[j]] = true;
				}
			}
			navLink.addEventListener("click", function(event) {
				var
					target = event.target,
					targets = target.dataset.targets.split(",");
				for (var k in navTargets) {
					if (navTargets.hasOwnProperty(k)) {
						if (targets.indexOf(k) >= 0) {
							document.getElementById(k).style.display = "";
						} else {
							document.getElementById(k).style.display = "none";
						}
					}
				}
				for (var i = 0; i < navLinks.length; i++) {
					var navLink = navLinks[i];
					if (navLink === target) {
						navLink.classList.add("active");
					} else {
						navLink.classList.remove("active");
					}
				}
				layoutManager.layout();
				var e = document.createEvent("HTMLEvents");
				e.initEvent("scroll", true, true);
				window.dispatchEvent(e);
				event.stopPropagation();
				event.preventDefault();
			});
		}

		setTimeout(function() {
			if (document.location.hash) {
				setSearchTerms(decodeURI(document.location.hash.substring(1)), "location");
			} else {
				setSearchTerms("", "location");
			}
			updatePlaylist();
		}, 500);

		window.addEventListener("popstate", function() {
			setSearchTerms(decodeURI(document.location.hash.substring(1)), "location");
		});

		window.addEventListener("keydown", function(event) {
			var terms = document.getElementById("search-terms");
			if (event.target === terms) {
				return;
			}
			if (event.keyCode === 0x46 && event.ctrlKey) {
				terms.focus();
			} else if (event.keyCode === 191 && event.shiftKey || event.keyCode === 111) {
				terms.value = "";
				terms.focus();
			} else if (event.keyCode === 8) {
				if (terms.value) {
					if (event.ctrlKey) {
						setSearchTerms("")
					} else {
						setSearchTerms(terms.value.substring(0, terms.value.length - 1));
					}
				}
			} else {
				return;
			}
			event.preventDefault();
		});

		window.addEventListener("keypress", function(event) {
			var terms = document.getElementById("search-terms");
			if (event.target === terms) {
				return;
			}
			setSearchTerms(terms.value + String.fromCharCode(event.keyCode));
		});

		queryUser();
	}, 0);
}
