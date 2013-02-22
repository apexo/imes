function PlaylistSelector(target, add, settings, userStatus, aggregateSelector, layoutManager) {
	this.target = target;
	this.add = add;
	userStatus.onready.addListener(this.updateMaybe, this);
	settings.onupdate.addListener(this.updateMaybe, this);
	this.settings = settings;
	this.userStatus = userStatus;
	this.playlists = null;
	this.playlistUpdatePending = false;
	this.locallyCreatedPlaylists = [];

	this.targetPlaylist = "";
	this.newAggregate = null;
	this.userPlaylist = false;
	this.options = null;

	this.onplaylistselect = new Event();

	target.addEventListener("change", this.handleSelect.bind(this), false);
	add.addEventListener("click", this.handleAdd.bind(this), false);
	aggregateSelector.onaggregatechange.addListener(this.aggregateChanged, this);

	this.layoutManager = layoutManager;

	this.updateMaybe();
}

PlaylistSelector.prototype.updatePlaylists = function() {
	if (this.playlistUpdatePending) {
		return;
	}
	this.playlistUpdatePending = true;
	var
		base = "playlist:user:" + this.userStatus.userName,
		view = DB_URL + DB_NAME +  "/_design/playlist/_view/all?group=true&startkey=" + encodeURIComponent(JSON.stringify(base + ":")) + "&endkey=" + encodeURIComponent(JSON.stringify(base + ":" + COUCH_SUFFIX));
	ajax_get(view, this.processPlaylists.bind(this));
}

PlaylistSelector.prototype.processPlaylists = function(result) {
	this.playlists = [];
	var rows = result.rows;
	for (var i = 0; i < rows.length; i++) {
		this.playlists.push(rows[i].key);
	}
	this.playlistUpdatePending = false;
	this.updateMaybe();
}

PlaylistSelector.prototype.updateMaybe = function() {
	if (this.userStatus.ready && !this.playlists) {
		this.updatePlaylists();
	}
	if (!this.settings.ready || !this.playlists) {
		return;
	}

	this.target.innerHTML = "";
	var options = [];
	var channels = this.settings.lists.channel;

	for (var i = 0; i < channels.length; i++) {
		var v = "playlist:channel:" + channels[i];
		addOption(this.target, "[" + channels[i] + "]", v);
		options.push(v);
	}
	addOption(this.target, "[None]", "");
	options.push("");

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
		addOption(this.target, name, pl);
		options.push(pl);
	}

	this.layoutManager.layout();

	this.options = options;

	if (this.newAggregate) {
		this.aggregateChanged(this.newAggregate);
	} else {
		if (this.options.indexOf(this.targetPlaylist) >= 0) {
			this.target.value = this.targetPlaylist;
		} else {
			console.log("playlist does not exist (anymore):", this.targetPlaylist);
			this.target.value = "";
			this.update("");
		}
	}
}

PlaylistSelector.prototype.update = function(value) {
	value = value || "";

	if (this.options.indexOf(value) < 0) {
		console.log(this.settings.ready, this.userStatus.ready, this.playlists, this.options);
		console.trace();
		console.log("playlist does not exist (anymore):", value);
		value = "";
	}

	this.userPlaylist = value.substring(0, 14) === "playlist:user:";
	if (value.substring(0, 17) === "playlist:channel:") {
		this.userStatus.setDisplayChannel(value.substring(17));
	} else {
		this.userStatus.setDisplayChannel(null);
	}

	if (this.targetPlaylist !== value) {
		console.log("change playlist", this.targetPlaylist, "->", value);
		this.targetPlaylist = value;
		this.onplaylistselect.fire(this, this, value);
	}
}

PlaylistSelector.prototype.handleSelect = function() {
	this.update(this.target.value);
}

PlaylistSelector.prototype.handleAdd = function(event) {
	event.preventDefault();
	if (!this.userStatus.userName) {
		alert("Impossible: user name not known.");
		return;
	}
	var name = prompt("Enter name of new playlist");
	if (name) {
		if (!/^[a-z][-a-z0-9]*$/.test(name)) {
			alert("Illegal name: must start with a small letter (a-z) and may only contain small letters (a-z), digits (0-9) and hypens (-) after that");
			return;
		}
		var qname = "playlist:user:" + this.userStatus.userName + ":" + name;
		if (this.locallyCreatedPlaylists.indexOf(qname) >= 0 || this.playlists.indexOf(qname) >= 0) {
			alert("A playlist with that name already exists.");
			return;
		}
		this.locallyCreatedPlaylists.push(qname);
		this.update(qname);
		this.updateMaybe();
	}
}

PlaylistSelector.prototype.aggregateChanged = function(aggregate) {
	if (!aggregate) {
		return;
	}
	if (!this.options) {
		this.newAggregate = aggregate;
		return;
	}
	this.newAggregate = null;
	if (this.settings.aggregates.hasOwnProperty(aggregate)) {
		var pl = "playlist:channel:" + this.settings.aggregates[aggregate].channel;
		pl = pl === "playlist:channel:" ? "" : pl;
		this.target.value = pl;
		this.update(pl);
	} else {
		console.log("user seems to be member of a non-existing aggregate:", aggregate);
	}
}
