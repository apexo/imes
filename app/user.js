function UserStatus() {
	this.onready = new Event();
	this.onupdate = new Event();
	this.oninvalidate = new Event();
	this.ready = false;
	this.userName = null;
	this.authToken = null;
	this.status = null;

	this.pending = null;
	this.scheduled = false;
	this.displayChannel = null;

	ajax_get(DB_URL + "_session", this.sessionLoaded.bind(this));
}

UserStatus.prototype.sessionLoaded = function (session) {
	if (!session.userCtx || !session.userCtx.name) {
		alert("could not retrieve user info");
		return;
	}

	this.userName = session.userCtx.name;

	ajax_get(DB_URL + "_users/org.couchdb.user:" + this.userName, this.userLoaded.bind(this));
}

UserStatus.prototype.generateAuthToken = function() {
	var result = "", chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.";
	for (var i = 0; i < 40; i++) {
		result += chars.charAt(Math.floor(Math.random() * 64));
	}
	return result;
}

UserStatus.prototype.userSaved = function() {
	ajax_get(DB_URL + "_users/org.couchdb.user:" + this.userName, this.userLoaded.bind(this));
}

UserStatus.prototype.userSavedError = function() {
	alert("error storing auth token");
}

UserStatus.prototype.userLoaded = function(user) {
	if (!user.imes) {
		user.imes = {};
	}
	if (!user.imes.authToken) {
		user.imes.authToken = this.generateAuthToken();
		ajax_post(DB_URL + "_users/org.couchdb.user:" + this.userName, user, this.userSaved.bind(this), {"method": "PUT"});
		return;
	}

	this.authToken = user.imes.authToken;

	this.ready = true;
	this.onready.fire(this, this);
	this.trigger();
}

UserStatus.prototype.backendUrl = function() {
	return BACKEND + "user/" + this.userName + "/" + this.authToken + "/";
}

UserStatus.prototype.statusLoaded = function(s) {
	this.pending = null;
	this.status = s;
	this.onupdate.fire(this, s);
	this.schedule(5000);
}

UserStatus.prototype.setDisplayChannel = function(value) {
	if (this.displayChannel !== value) {
		this.status = null;
		this.displayChannel = value;
		this.oninvalidate.fire(this);
		this.trigger();
	}
}

UserStatus.prototype.trigger = function() {
	if (this.pending) {
		ajax_abort(this.pending);
	}
	var url = this.backendUrl() + "status";
	if (this.displayChannel) {
		url += "?channel=" + encodeURIComponent(this.displayChannel);
	}
	this.pending = ajax_get(url, this.statusLoaded.bind(this));
}

UserStatus.prototype.triggerScheduledUpdate = function() {
	this.scheduled = false;
	this.trigger();
}

UserStatus.prototype.schedule = function(timeout) {
	if (!this.scheduled) {
		this.scheduled = true;
		setTimeout(this.triggerScheduledUpdate.bind(this), timeout || 5000);
	}
}

UserStatus.prototype.setUserAggregate = function(aggregate) {
	ajax_post(this.backendUrl() + "status", {"aggregate": aggregate}, this.trigger.bind(this));
}

UserStatus.prototype.setLockout = function(value) {
	ajax_post(this.backendUrl() + "status", {"lockout": value}, this.trigger.bind(this));
}

UserStatus.prototype.setSessionTimeout = function(value) {
	ajax_post(this.backendUrl() + "status", {"session_timeout": value}, this.trigger.bind(this));
}
