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
	var instead = i._id.substring(i._id.lastIndexOf("/"));
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
	var offset = 0;
	var placeHolder = document.createElement("div");
	var albumCache = {};
	var scrollParent = document.body;
	ac = albumCache;
	placeHolder.style.visibility = "hidden";
	placeHolder.style.height = Math.floor(scrollParent.parentElement.clientHeight / 2) + "px";

	target.innerHTML = "";
	target.appendChild(placeHolder);

	function addCover(target, info) {
		if (!info.pictures || !info.pictures.length) {
			return;
		}
		var p = info.pictures[0];
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
		cover.src = DB_URL + DB_PREFIX + "picture/" + p.key + "/" + f.f;
		target.appendChild(cover);
	}

	function doProcess(i) {
		var album = i.album && i.album.length ? i.album[0] : "";
		var artist = i.artist && i.artist.length ? i.artist[0] : "";
		var title = i.title && i.title.length ? i.title[0] : "";
		var path = i._id.substring(0, i._id.lastIndexOf("/"));
		var disc = i.discnumber;

		var key = album ? path + '\x00' + album + '\x00' + (disc || 0) : null;
		var cachedAlbum = key ? albumCache[key] : null;

		if (!cachedAlbum) {
			var t = document.createElement("div");
			t.classList.add("single-track");
			if (album) {
				t.appendChild(document.createTextNode("["));
				albumLink(i, t);
				t.appendChild(document.createTextNode("] "));
			}
			artistLink(i, t);
			t.appendChild(document.createTextNode(" - "));
			titleLink(i, t);

			if (key) {
				albumCache[key] = {
					t: t,
					i: i,
					ids: {}
				}
				albumCache[key].ids[i._id] = true;
			}
			target.insertBefore(t, placeHolder);
			return;
		}

		if (cachedAlbum.ids.hasOwnProperty(i._id)) {
			return;
		}
		cachedAlbum.ids[i._id] = true;

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

			formatAlbumTrack(cachedAlbum.i, tracklist);
			target.removeChild(cachedAlbum.t);
			delete cachedAlbum.t;
			delete cachedAlbum.i;
		} else {
			target.removeChild(cachedAlbum.container);
		}

		formatAlbumTrack(i, cachedAlbum.tracklist);
		target.insertBefore(cachedAlbum.container, placeHolder);
	}

	var state = "loading";

	function resume(ids, done) {
		if (currentSearchToken !== mySearchToken) {
			return;
		}
		for (var i = 0; i < ids.length; i++) {
			doProcess(ids[i].doc);
		}
		if (done) {
			target.removeChild(placeHolder);
			placeHolder = null;
			window.onscroll = null;
			state = "done";
			return;
		}
		offset += ids.length;
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

	view.fetch(resume, page);
}

function maybeResume() {
	var middle = document.body;
	if (middle.onscroll) {
		middle.onscroll();
	}
}

function enqueueTracks(ids) {
	console.log("TODO", "enqueue", ids);
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

	}, 0);
}
