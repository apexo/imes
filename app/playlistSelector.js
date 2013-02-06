function PlaylistSelector(target, add, settings, userStatus) {
	this.target = target;
	this.add = add;
	userStatus.onupdate.addListener(this.updateMaybe, this);
	settings.onupdate.addListener(this.updateMaybe, this);
	this.settings = settings;
	this.userStatus = userStatus;
	this.playlists = null;
	this.playlistUpdatePending = false;
	this.locallyCreatedPlaylists = [];

	this.targetPlaylist = undefined;
	this.aggregate = undefined;
	this.userPlaylist = false;

	this.onplaylistselect = new Event();

	target.addEventListener("change", this.handleSelect.bind(this), false);
	add.addEventListener("click", this.handleAdd.bind(this), false);
}

PlaylistSelector.prototype.updatePlaylists = function() {
	if (this.playlistUpdatePending) {
		return;
	}
	this.playlistUpdatePending = true;
	var
		base = "playlist:user:" + this.userStatus.userName,
		view = DB_URL + DB_NAME +  "/_design/playlist/_view/all?group=true&startkey=" + encodeURIComponent(JSON.stringify(base + ":")) + "&endkey=" + encodeURIComponent(JSON.stringify(base + ":~"));
	ajax_get(view, this.processPlaylists.bind(this));
}

PlaylistSelector.prototype.processPlaylists = function(result) {
	this.playlists = JSON.parse(result).rows;
	this.playlistUpdatePending = false;
}

PlaylistSelector.prototype.updateMaybe = function() {
	if (this.userStatus.ready && !this.playlists) {
		this.updatePlaylists();
		return;
	}
	if (!this.settings.ready || !this.userStatus.status || !this.playlists) {
		return;
	}
	var aggregate = this.aggregate === undefined ? this.userStatus.status.aggregate : this.aggregate;
	var targetPlaylist = this.targetPlaylist === undefined ? (this.userStatus.status.channel ? "playlist:channel:" + this.userStatus.status.channel : "") : this.targetPlaylist;

	this.target.innerHTML = "";
	var validValues = {};
	var aggregates = this.settings.lists.aggregate;
	var currentAggregate = this.userStatus.status.aggregate || "";
	for (var i = 0; i < aggregates.length; i++) {
		var a = aggregates[i];
		var c = this.settings.aggregates[a].channel;
		if (c) {
			addOption(this.target, "[Aggregate " + a + ", Channel " + c + "]", a);
		} else {
			addOption(this.target, "[Aggregate " + a + ", No Channel]", a);
		}
		validValues[a] = true;
	}
	addOption(this.target, "[None]", "");
	var playlists = this.playlists.concat([]);
	for (var i = 0; i < this.locallyCreatedPlaylists.length; i++) {
		var pl = this.locallyCreatedPlaylists[i];
		if (playlists.indexOf(pl) < 0) {
			playlists.push(pl);
		}
	}
	playlists.sort();
	for (var i = 0; i < playlists.length; i++) {
		var pl = playlists[i], idx = pl.lastIndexOf(":"), name = pl.substring(idx + 1);
		addOption(this.target, "Playlist " + name, pl);
		validValues[pl] = true;
	}

	var value;

	if (this.userPlaylist && targetPlaylist && validValues.hasOwnProperty(targetPlaylist)) {
		value = targetPlaylist;
	} else if (aggregate && validValues.hasOwnProperty(aggregate)) {
		value = aggregate;
	} else {
		value = "";
	}

	this.target.value = value;
	this.update(value);

	layoutManager.layout();
}

PlaylistSelector.prototype.update = function(value) {
	var tpl = this.targetPlaylist, aggregate = this.aggregate;
	if (!value) {
		tpl = "";
		this.userPlaylist = false;
		aggregate = "";
	} else if (value.substring(0, 14) === "playlist:user:") {
		tpl = value;
		this.userPlaylist = true;
	} else {
		this.userPlaylist = false;
		aggregate = value;
		if (this.settings.ready) {
			if (!this.settings.aggregates.hasOwnProperty(value)) {
				console.log("weird, someone tried selecting an aggregate that doesn't exist (anymore)");
				return;
			}
			var c = this.settings.aggregates[value].channel;
			tpl = c ? "playlist:channel:" + c : "";
		} else {
			console.log("someone selected an aggregate while a settings-update is in progress …");
		}
	}

	if (tpl !== this.targetPlaylist) {
		console.log("change playlist", this.targetPlaylist, "->", tpl);
		this.targetPlaylist = tpl;
		this.onplaylistselect.fire(this, this, tpl);
	}

	if (aggregate !== this.aggregate) {
		console.log("change aggregate", this.aggregate, "->", aggregate);
		this.aggregate = aggregate;
		this.userStatus.setUserAggregate(aggregate);
	}
}

PlaylistSelector.prototype.handleSelect = function() {
	this.update(this.target.value);
}

PlaylistSelector.prototype.handleAdd = function() {
	alert("not implemented yet");
}
