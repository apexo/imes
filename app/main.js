(function() {
	var d = document.createElement("div");
	if (!d.scrollIntoViewIfNeeded) {
		d.constructor.prototype.scrollIntoViewIfNeeded = function() {
			this.scrollIntoView();
		}
	}
})();

function displayTrackInfo(fid, event) {
	var target = document.getElementById("track-info-popup");

	function click(event) {
		if (event.target.localName === "a") {
			return;
		}
		target.style.display = "none";
		target.onclick = null;
	}

	function labeledValue(label, value) {
		var result = document.createElement("div");
		var b = result.appendChild(document.createElement("b"));
		b.appendChild(document.createTextNode(label + " "));
		result.appendChild(document.createTextNode(value));
		return result;
	}
	function labeledLink(label, value, href) {
		var result = document.createElement("div");
		var b = result.appendChild(document.createElement("b"));
		b.appendChild(document.createTextNode(label + " "));
		var a = document.createElement("a");
		a.href = href;
		a.appendChild(document.createTextNode(value));
		result.appendChild(a);
		return result;
	}
	function showTrackInfoPopup(info) {
		var el = event.target, x = event.offsetX, y = event.offsetY - document.body.scrollTop;
		while (el && el !== document.body) {
			x += el.offsetLeft;
			y += el.offsetTop;
			el = el.offsetParent;
		}

		target.innerHTML = "";

		target.appendChild(labeledValue("path", info.path));
		target.appendChild(labeledValue("id", info._id));
		target.appendChild(labeledValue("size", info.size));
		target.appendChild(labeledValue("mtime", info.mtime));
		if (info.info.length) {
			target.appendChild(labeledValue("length", info.info.length + ""));
		}
		if (info.discnumber && info.totaldiscs) {
			target.appendChild(labeledValue("disc number", info.discnumber + " / " + info.totaldiscs));
		} else if (info.discnumber) {
			target.appendChild(labeledValue("disc number", info.discnumber));
		}
		for (var i = 0; info.album && i < info.album.length; i++) {
			target.appendChild(labeledValue("album", info.album[i]));
		}
		if (info.tracknumber && info.totaltracks) {
			target.appendChild(labeledValue("track number", info.tracknumber + " / " + info.totaltracks));
		} else if (info.tracknumber) {
			target.appendChild(labeledValue("track number", info.tracknumber));
		}
		for (var i = 0; info.artist && i < info.artist.length; i++) {
			target.appendChild(labeledValue("artist", info.artist[i]));
		}
		for (var i = 0; info.title && i < info.title.length; i++) {
			target.appendChild(labeledValue("title", info.title[i]));
		}
		for (var i = 0; info.musicbrainz_albumartistid && i < info.musicbrainz_albumartistid.length; i++) {
			target.appendChild(labeledLink("musicbrainz album artist ID",
				info.musicbrainz_albumartistid[i],
				"http://musicbrainz.org/artist/" + info.musicbrainz_albumartistid[i]
			));
		}
		for (var i = 0; info.musicbrainz_albumid && i < info.musicbrainz_albumid.length; i++) {
			target.appendChild(labeledLink("musicbrainz album ID",
				info.musicbrainz_albumid[i],
				"http://musicbrainz.org/release/" + info.musicbrainz_albumid[i]
			));
		}
		for (var i = 0; info.musicbrainz_artistid && i < info.musicbrainz_artistid.length; i++) {
			target.appendChild(labeledLink("musicbrainz artist ID",
				info.musicbrainz_artistid[i],
				"http://musicbrainz.org/artist/" + info.musicbrainz_artistid[i]
			));
		}
		for (var i = 0; info.musicbrainz_trackid && i < info.musicbrainz_trackid.length; i++) {
			target.appendChild(labeledLink("musicbrainz track ID",
				info.musicbrainz_trackid[i],
				"http://musicbrainz.org/recording/" + info.musicbrainz_trackid[i]
			));
		}
		for (var i = 0; info.genre && i < info.genre.length; i++) {
			target.appendChild(labeledValue("genre", info.genre[i]));
		}
		if (info.replaygain_track_gain) {
			target.appendChild(labeledValue("track gain", info.replaygain_track_gain));
		}
		if (info.replaygain_track_peak) {
			target.appendChild(labeledValue("track peak", info.replaygain_track_peak));
		}
		if (info.replaygain_album_gain) {
			target.appendChild(labeledValue("album gain", info.replaygain_album_gain));
		}
		if (info.replaygain_album_peak) {
			target.appendChild(labeledValue("album peak", info.replaygain_album_peak));
		}

/* {
"media":"CD",
"codec":"mp3",
"type":"file",
"tags":["id3","apev2"],
"date":"1993",
"container":"mpeg",
"info":{"layer":3,"padding":false,"length":137.08533333333332394,"version":1,"sample_rate":44100,"mode":1,"protected":false,"bitrate":192000},
"pictures":[]
} */

		var root = document.body.parentElement, width = root.clientWidth, height = root.clientHeight;

		target.style.display = "";
		target.onclick = click;
		target.style.top = target.style.left = "";
		target.style.overflowY = "";
		target.style.right = (width - (x - 10)) + "px";
		target.style.bottom = (height - y) + "px";

		if (target.clientWidth * 100 > width * 90) {
			target.style.left = "5px";
		}
		if (target.clientHeight * 100 > height * 90) {
			target.style.left = "5px";
			target.style.right = "5px";
			target.style.top = "5px";
			target.style.bottom = "5px";
			target.style.overflowY = "scroll";
		} else if (y - target.clientHeight < 5) {
			target.style.bottom = "";
			target.style.top = "5px";
		}
	}

	get_file_info(fid, showTrackInfoPopup);
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

function createButtonContainer(target) {
	var ra = document.createElement("div");
	ra.classList.add("right-align");
	var cr = document.createElement("div");
	cr.classList.add("clear-right");
	target.appendChild(ra);
	target.appendChild(cr);
	return ra;
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

	var bc = createButtonContainer(track);
	bc.appendChild(createLengthIndicator(formatLength(i.info.length)));
	btns.createAlbumTrackButtons(bc);
	return track;
}

function formatErrorTrack(id, btns) {
	var track = document.createElement("div");
	track.classList.add("single-track");
	track.appendChild(document.createTextNode("deleted track: " + id));
	track.dataset.id = id;
	track.dataset.length = 0;

	var bc = createButtonContainer(track);
	bc.appendChild(createLengthIndicator(formatLength(0)));
	btns.createSingleTrackButtons(bc);
	return track;
}

function formatSingleTrack(i, btns) {
	var track = document.createElement("div");
	track.classList.add("single-track");
	if (i.album && i.album.length) {
		track.appendChild(document.createTextNode("["));
		albumLink(i, track);
		track.appendChild(document.createTextNode("] "));
	}
	artistLink(i, track);
	track.appendChild(document.createTextNode(" - "));
	titleLink(i, track);
	track.dataset.id = i._id;
	track.dataset.length = i.info.length;

	var bc = createButtonContainer(track);
	bc.appendChild(createLengthIndicator(formatLength(i.info.length)));
	btns.createSingleTrackButtons(bc);
	return track;
}

function createButton(target, type, title) {
	var button = document.createElement("a");
	button.href = "";
	button.classList.add(type + "-button");
	button.appendChild(document.createTextNode("\xa0"));
	button.title = title;
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
	return {
		w: Math.floor(nw),
		h: Math.floor(nh)
	};
}

var THUMB_WIDTH = 160;
var THUMB_HEIGHT = 160;
var THUMB_TYPE = 3; // front

function selectPicture(info, width, height, type) {
	if (!info.pictures || !info.pictures.length) {
		return;
	}
	var pictureWithProperType = info.pictures.filter(function(p) {return p.type === type;});
	var selectedPicture = pictureWithProperType.length ? pictureWithProperType[0] : info.pictures[0];
	var formats = [];

	for (var key in selectedPicture.formats) {
		if (selectedPicture.formats.hasOwnProperty(key)) {
			var format = selectedPicture.formats[key];
			var size = scaledSize(format, width, height);
			formats.push([!(format.w > size.w && format.h > size.h), format.w*format.h, format, size]);
		}
	}

	formats.sort(function(a, b) {
		if (a[0] != b[0]) {
			return a[0] - b[0];
		}
		return a[1] - b[1];
	});
	var format = formats[0][2];
	var size = formats[0][3];

	return {
		width: size.w,
		height: size.h,
		src: DB_URL + DB_NAME + "/" + selectedPicture.key + "/" + format.f
	}
}

function addCover(target, info) {
	if (target.querySelector(".album-cover")) {
		return;
	}
	var p = selectPicture(info, THUMB_WIDTH, THUMB_HEIGHT, THUMB_TYPE);
	if (p) {
		var cover = document.createElement("img");
		cover.classList.add("album-cover");
		cover.width = p.width;
		cover.height = p.height;
		cover.src = p.src;
		target.insertBefore(cover, target.querySelector(".album-tracklist"));
	}
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

	var bc = createButtonContainer(label);
	btns.createAlbumButtons(bc);
	c.appendChild(document.createElement("div")).classList.add("clear-left");
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
		track.parentElement.removeChild(track);
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

function deleteFromPlaylist(plid, idxs) {
	var url = DB_URL + DB_NAME + "/" + encodeURIComponent(plid);
	function doDelete(value) {
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
			ajax_post(url, value, null, {"method": "PUT"});
		} else {
			ajax_get(url + "?rev=" + value._rev, null, {"method": "DELETE"});
		}
	}
	ajax_get(url, doDelete);
}

function enqueueTracks(ids) {
	if (!playlistSelector.targetPlaylist) {
		return alert("No playlist selected.");
	}
	var
		tpl = playlistSelector.targetPlaylist,
		date = new Date().toISOString().replace(/[-:.TZ]/g, ""),
		rnd = Math.floor(Math.random() * 4294967296).toString(16);
	while (rnd.length < 8) {
		rnd = "0" + rnd;
	}
	var id = encodeURIComponent(tpl + ":" + date + ":" + rnd);
	ajax_post(DB_URL + DB_NAME + "/" + id, {
		"type": "playlist",
		"items": ids
	}, null, {"method": "PUT"});
}

function setSearchTerms(terms, source) {
	if (source !== "location") {
		document.location.href = "#" + encodeURI(terms);
	}
	if (source !== "user") {
		var target = document.querySelector("#search-terms");
		if (target.value !== terms) {
			target.value = terms;
		}
	}
	search.update(terms);
}

function addOption(select, name, value) {
	var option = select.appendChild(document.createElement("option"));
	option.appendChild(document.createTextNode(name));
	option.value = value;
	return option;
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

var lastPlaying = {plid: "", idx: 0};

function updateNowPlaying(s) {
	if (!s || !s.currentlyPlaying || s.paused) {
		// not playing (except autoPaused) -> reset lastPlaying
		lastPlaying.plid = "";
		lastPlaying.idx = 0;
		return;
	}
	if (s.currentlyPlaying.plid === lastPlaying.plid && s.currentlyPlaying.idx === lastPlaying.idx) {
		// still playing same as before -> no chance
		return;
	}

	lastPlaying.plid = s.currentlyPlaying.plid;
	lastPlaying.idx = s.currentlyPlaying.idx;

	get_file_info(s.currentlyPlaying.fid, function(result) {
		if (result) {
			notification.nowPlaying(result);
		}
	});
}

function isVisible(element, within) {
	if (within) {
		if (element.offsetTop + element.clientHeight - within.scrollTop <= 0) {
			return false;
		}
		if (element.offsetTop - within.scrollTop >= within.parentElement.clientHeight) {
			return false;
		}
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

function playNow(track) {
	var
		key = track.dataset.key,
		fid = track.dataset.id;

	ajax_post(userStatus.backendUrl() + "play", {
		"plid": plkey_plid(key),
		"idx": plkey_idx(key),
		"fid": fid
	});
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
		} else if (cl.contains("info-button")) {
			button = "info";
		}
		if (button) {
			event.preventDefault();
			target = target.parentElement.parentElement;
			cl = target.classList;

			if (cl.contains("album-track")) {
				handler.handleAlbumTrack(button, target, event);
			} else if (cl.contains("album-label")) {
				handler.handleAlbum(button, target, event);
			} else if (cl.contains("single-track")) {
				handler.handleSingleTrack(button, target, event);
			} else {
				return;
			}
		} else if (cl.contains("album-link")) {
			event.preventDefault();
			handler.handleSearch("album2:" + encodeURI(target.firstChild.textContent));
		} else if (cl.contains("artist-link")) {
			event.preventDefault();
			handler.handleSearch("artist2:" + encodeURI(target.firstChild.textContent));
		} else if (cl.contains("title-link")) {
			event.preventDefault();
			handler.handleSearch("title2:" + encodeURI(target.firstChild.textContent));
		} else {
			return;
		}
		event.stopPropagation();
	}, false);
}

var subscription;
var userStatus;
var scrollBarWidth;
var settings;
var playlistSelector;
var navigation;
var notification;
var search;

function onLoad() {
	if (subscription) {
		alert("???");
		return;
	}

	var temp = document.createElement("div");
	temp.style.width = "200px"
	temp.style.overflowY = "scroll";
	document.body.appendChild(temp);
	scrollBarWidth = 200 - temp.scrollWidth;
	document.body.removeChild(temp);
	temp = null;

	document.getElementById("spacer").style.width = scrollBarWidth + "px";

	notification = new DOMNotification();
	notification.onready.addListener(function(result) {
		document.getElementById("notifications").innerHTML = result;
	});

	subscription = new Subscription({
		"include_docs": "true",
		"limit": 20,
		"filter": "file/all",
		"timeout": 59000,
	})
	userStatus = new UserStatus();
	userStatus.onupdate.addListener(updateNowPlaying);
	settings = new Settings(userStatus);

	var playlistTarget = document.getElementById("playlist-select");
	var playlistAdd = document.getElementById("playlist-add");
	playlistSelector = new PlaylistSelector(playlistTarget, playlistAdd, settings, userStatus);

	new ChannelControl(document.getElementById("channel-control"), userStatus);

	subscription.onchange.addListener(function(changes) {
		for (var i = 0; i < changes.length; i++) {
			var change = changes[i];
			if (!change.deleted && change.doc.type === "imes:channel") {
				console.log(change.doc);
				userStatus.trigger();
			}
		}
	});

	navigation = new Navigation(document.getElementById("nav"), layoutManager);
	search = new Search(document.getElementById("search-result"), subscription, navigation);

	var terms = document.location.hash ? decodeURI(document.location.hash.substring(1)) : "";
	setSearchTerms(terms, "location");

	playlist = new Playlist(document.getElementById("playlist"), subscription, navigation, playlistSelector, userStatus);

	setTimeout(function() {
		new HeaderLayout(document.body);
		new HBoxLayout(document.querySelector("#header"));
		new VBoxLayout(document.querySelector("#header-inner"));
		new HBoxLayout(document.querySelector("#top"));
		new HBoxLayout(document.querySelector("#top .filter"));
	
		layoutManager.layout();
		window.addEventListener("resize", function() {
			layoutManager.layout();
		});
		installClickHandler(document.getElementById("search-result"), SearchResult);
		installClickHandler(document.getElementById("playlist"), PlaylistDisplay);

		window.addEventListener("popstate", function() {
			setSearchTerms(decodeURI(document.location.hash.substring(1)), "location");
		});

		window.addEventListener("keydown", function(event) {
			var terms = document.getElementById("search-terms");
			if (event.target === terms) {
				if (event.keyCode == 27) { // ESC
					terms.blur();
				}
				return;
			}
			if (!isVisible(terms)) {
				return;
			}
			if (event.keyCode === 0x46 && event.ctrlKey) { // ctrl+f
				terms.focus();
			} else if (event.keyCode === 191 && event.shiftKey || event.keyCode === 111) { // "/"
				terms.value = "";
				terms.focus();
			} else if (event.keyCode === 8) {
				if (terms.value) {
					if (event.ctrlKey) { // ctrl+backspace
						setSearchTerms("")
					} else { // backspace
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
			if (!isVisible(terms)) {
				return;
			}
			setSearchTerms(terms.value + String.fromCharCode(event.keyCode));
		});
	}, 0);
}
