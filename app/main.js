var currentSearchToken = 0;
var currentPlaylistToken = 0;
var remote = null;
var plidCache = {};

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

function formatAlbumTrack(i, tracklist, position) {
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

	return track;
}

function formatSingleTrack(i) {
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
	return t;
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

function makeAlbum(i, key) {
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

	return c;
}

function albumKey(i) {
	var album = i.album && i.album.length ? i.album[0] : "";
	var path = i.path.substring(0, i.path.lastIndexOf("/"));
	var disc = i.discnumber;

	return album ? path + '\x00' + album + '\x00' + (disc || 0) : null;
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
		if (t.classList.contains("single-track")) {
			target.removeChild(t);
		} else {
			var tracklist = t.parentElement;
			tracklist.removeChild(t);
			// TODO: maybe downgrade single remaining track to single-track?
			if (!tracklist.firstElementChild) {
				var albumContainer = tracklist.parentElement;
				delete albumCache[albumContainer.dataset.key];
				target.removeChild(albumContainer);
			}
		}
	}

	function add(i) {
		if (idCache.hasOwnProperty(i._id)) {
			return;
		}

		var album = i.album && i.album.length ? i.album[0] : "";
		var artist = i.artist && i.artist.length ? i.artist[0] : "";
		var title = i.title && i.title.length ? i.title[0] : "";
		var path = i.path.substring(0, i.path.lastIndexOf("/"));
		var disc = i.discnumber;

		var key = album ? path + '\x00' + album + '\x00' + (disc || 0) : null;
		var cachedAlbum = key ? albumCache[key] : null;

		if (!cachedAlbum) {
			var t = formatSingleTrack(i);
			idCache[i._id] = t;

			if (key) {
				albumCache[key] = {t: t, i: i}
			}
			target.insertBefore(t, placeHolder);
			return;
		}

		var tracklist;

		if (!cachedAlbum.container) {
			cachedAlbum.container = makeAlbum(i, key);
			tracklist = cachedAlbum.container.getElementsByClassName("album-tracklist")[0];

			idCache[cachedAlbum.i._id] = formatAlbumTrack(cachedAlbum.i, tracklist);
			target.removeChild(cachedAlbum.t);
			delete cachedAlbum.t;
			delete cachedAlbum.i;
		} else {
			addCover(cachedAlbum.container, i);
			target.removeChild(cachedAlbum.container);
			tracklist = cachedAlbum.container.getElementsByClassName("album-tracklist")[0];
		}


		idCache[i._id] = formatAlbumTrack(i, tracklist);
		target.insertBefore(cachedAlbum.container, placeHolder);
	}

	var state = "loading";

	function resume(ids, done) {
		if (currentSearchToken !== mySearchToken) {
			return;
		}
		for (var i = 0; i < ids.length; i++) {
			add(ids[i].doc);
		}
		if (done) {
			target.removeChild(placeHolder);
			placeHolder = null;
			window.removeEventListener("scroll", doScroll);
			window.removeEventListener("resize", doScroll);
			state = "done";
			return;
		}
		if (placeHolder.offsetTop - scrollParent.scrollTop < scrollParent.parentElement.clientHeight) {
			view.fetch(resume, page);
		} else {
			state = "paused";
		}
	}

	function doScroll() {
		if (currentSearchToken !== mySearchToken) {
			return;
		}

		if (state === "paused") {
			if (isVisible(placeHolder, scrollParent)) {
				state = "loading";
				view.fetch(resume, page);
			}
		}
	}

	window.addEventListener("scroll", doScroll);
	window.addEventListener("resize", doScroll);

	function readyCb() {
		view.fetch(resume, page);
		return true;
	}

	function changesCb(changes) {
		if (currentSearchToken !== mySearchToken) {
			return false;
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

		doScroll();
	}

	var subscription = new Subscribe(readyCb, changesCb, {
		"include_docs": "true",
		"limit": 10,
		"filter": "file/all"
	});
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
	//console.log("TODO", "enqueue", ids);
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
				alaert("could not retrieve auth token");
				return;
			}
			currentUserAuthToken =  userInfo.imes.authToken;

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
	//pb.style.height = "100%";
	//pb.style.position = "absolute";
	//pb.style.backgroundColor = "green";
	//pb.style.opacity = "0.3";
	//pb.style.top = "0px";
	//pb.style.left = "0px";
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
	//result.style.position = "relative";
	//result.style.right = "1em";
	return result;
}

function updateProgressBar(pb, offset, length, t0) {
	var
		total = length ? Math.floor(length * 44100 + 0.5) : 0,
		pos = offset + Math.floor((Date.now() - t0) * 44.1 + 0.5);

	pb.previousElementSibling.firstChild.textContent = formatLength(length, pos / 44100);

	if (pos >= total) {
		pb.style.backgroundColor = "red";
		pb.style.width = "100%";
	} else {
		pb.style.width = Math.min(pos * 100 / total, 100) + "%";
	}
}

function removeProgressBar(element) {
	element.removeChild(element.getElementsByClassName("progress-bar")[0]);
	element.getElementsByClassName("length-indicator")[0].firstChild.textContent = formatLength(element.dataset.length);
	element.classList.remove("currently-playing");
	RAF.unregister("playlist");
}

function queryStatus() {
	ajax_get(BACKEND + "user/" + currentUserName + "/" + currentUserAuthToken + "/status", function(result) {
		var s = JSON.parse(result);

		currentStatus = s;

		if (s.channel !== currentChannel) {
			currentChannel = s.channel;
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
			if (!found && plidCache.hasOwnProperty(key)) {
				progressBar = createProgressBar();
				plidCache[key].classList.add("currently-playing");
				plidCache[key].appendChild(progressBar);
			}

			if (progressBar) {
				var length = plidCache[key].dataset.length;
				s.currentlyPlaying.length = length;
				updateProgressBar(progressBar, s.currentlyPlaying.pos, length, s.currentlyPlaying.t0);
				function update() {
					updateProgressBar(progressBar, s.currentlyPlaying.pos, length, s.currentlyPlaying.t0);
				}
				RAF.register("playlist", update);
			}
		}

		setTimeout(queryStatus, 5000);
	}, function() {
		setTimeout(queryStatus, 30000);
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
	plidCache = {};

	var target = document.querySelector("#playlist");
	target.innerHTML = "";
	if (!targetPlaylist) {
		return;
	}

	var plid, idx;
	if (targetPlaylist === "playlist:channel:" + currentStatus.channel && currentStatus.currentlyPlaying) {
		plid = currentStatus.currentlyPlaying.plid;
		idx = currentStatus.currentlyPlaying.idx;
	} else {
		plid = targetPlaylist;
		idx = 0;
	}

	var forwardPlaceHolder = document.createElement("div");
	var backwardPlaceHolder = document.createElement("div");
	/*var*/ view = new PlaylistView(targetPlaylist, plid, idx);
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
	var forwardActive = false;
	var backwardActive = false;
	var forwardDone = false;
	var backwardDone = false;

	var forwardLast, backwardLast = null;

	function add(item, last, insertBefore, p) {
		var key = albumKey(item.value), el;
		if (last && last.key && last.key === key) {
			if (!last.container) {
				last.container = makeAlbum(last.i, key);
				target.insertBefore(last.container, last.t);
				target.removeChild(last.t);
				plidCache[last.t.dataset.key] = el = formatAlbumTrack(last.i, last.container.getElementsByClassName("album-tracklist")[0]);
				el.dataset.key = last.t.dataset.key;
				delete last.t;
				delete last.i;
			}
			plidCache[item.key] = el = formatAlbumTrack(item.value, last.container.getElementsByClassName("album-tracklist")[0], p);
			el.dataset.key = item.key;
			// TODO: add progress bar if currently playing
			return last;
		}
		last = {
			t: formatSingleTrack(item.value),
			i: item.value,
			key: key
		};
		plidCache[item.key] = last.t;
		last.t.dataset.key = item.key;
		// TODO: add progress bar if currently playing
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
			forwardPlaceHolder = null;
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

	function release() {
		window.removeEventListener("scroll", doScroll);
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
			release();
		}
	}

	function doScroll() {
		update();
	}

	window.addEventListener("scroll", doScroll);

	update();
}

function playNow(track) {
	var
		key = track.dataset.key,
		sep = key.indexOf("\0"),
		plid = key.substring(0, sep),
		idx = parseInt(key.substring(sep+1)),
		fid = track.dataset.id;

	ajax_post(BACKEND + "user/" + currentUserName + "/" + currentUserAuthToken + "/play", {
		"plid": plid,
		"idx": idx,
		"fid": fid
	}, function() {}, null, "POST");
}

function onLoad() {
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
		document.querySelector("#search-result").addEventListener("click", function(event) {
			var target = event.target;
			var cl = target.classList;
			if (cl.contains("album-track")) {
				enqueueTracks([target.dataset.id]);
			} else if (cl.contains("album-label")) {
				var ids = [];
				var tracks = target.parentElement.querySelectorAll(".album-track");
				for (var i = 0; i < tracks.length; i++) {
					var t = tracks[i];
					ids.push(t.dataset.id);
				}
				enqueueTracks(ids);
			} else if (cl.contains("single-track")) {
				enqueueTracks([target.dataset.id]);
			} else if (cl.contains("album-link")) {
				setSearchTerms("album2:" + encodeURI(target.firstChild.textContent));
			} else if (cl.contains("artist-link")) {
				setSearchTerms("artist2:" + encodeURI(target.firstChild.textContent));
			} else if (cl.contains("title-link")) {
				setSearchTerms("title2:" + encodeURI(target.firstChild.textContent));
			} else {
				return;
			}
			event.stopPropagation();
			event.preventDefault();
		}, false);

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
