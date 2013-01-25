var currentSearchToken = 0;
var remote = null;

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

function formatAlbumTrack(i, tracklist) {
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
	track.appendChild(document.createTextNode(t));
	artistLink(i, track);
	track.appendChild(document.createTextNode(" - "));
	titleLink(i, track);

	var insertAfter = tracklist.lastElementChild;
	while (insertAfter && parseInt(insertAfter.dataset.tracknumber) > tracknumber) {
		insertAfter = insertAfter.previousElementSibling;
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
	t.dataset.id = i._id;
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

		if (!cachedAlbum.container) {
			var c = document.createElement("div");
			cachedAlbum.container = c;

			c.classList.add("album");
			var label = document.createElement("div");
			label.classList.add("album-label");
			formatAlbumName(i, label);
			c.appendChild(label);
			addCover(c, i);
			var tracklist = document.createElement("div");
			cachedAlbum.tracklist = tracklist;
			tracklist.classList.add("album-tracklist");
			c.appendChild(tracklist);
			c.dataset.key = key;

			idCache[cachedAlbum.i._id] = formatAlbumTrack(cachedAlbum.i, tracklist);
			target.removeChild(cachedAlbum.t);
			delete cachedAlbum.t;
			delete cachedAlbum.i;
		} else {
			addCover(cachedAlbum.container, i);
			target.removeChild(cachedAlbum.container);
		}

		idCache[i._id] = formatAlbumTrack(i, cachedAlbum.tracklist);
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
			window.onscroll = null;
			state = "done";
			return;
		}
		if (placeHolder.offsetTop - scrollParent.scrollTop < scrollParent.parentElement.clientHeight) {
			view.fetch(resume, page);
		} else {
			state = "paused";
		}
	}

	window.onscroll = function() {
		if (currentSearchToken !== mySearchToken) {
			return;
		}

		if (state === "paused") {
			if (placeHolder.offsetTop - scrollParent.scrollTop < scrollParent.parentElement.clientHeight) {
				state = "loading";
				view.fetch(resume, page);
			}
		}
	}


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
		maybeResume();
	}

	var subscription = new Subscribe(readyCb, changesCb, {
		"include_docs": "true",
		"limit": 10,
		"filter": "file/all"
	});
}

function maybeResume() {
	var middle = document.body;
	if (middle.onscroll) {
		middle.onscroll();
	}
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

function onLoad() {
	setTimeout(function() {
		//new ViewportLayout(document.body, new VBoxLayout(document.body));
		new HeaderLayout(document.body);
		new VBoxLayout(document.querySelector("#header"));
		new HBoxLayout(document.querySelector("#top .filter"));
	
		layoutManager.layout();
		window.onresize = function() {
			layoutManager.layout();
			maybeResume();
		};
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

		setTimeout(function() {
			if (document.location.hash) {
				setSearchTerms(decodeURI(document.location.hash.substring(1)), "location");
			} else {
				setSearchTerms("", "location");
			}
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
