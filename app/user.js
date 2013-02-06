function UserStatus() {
	this.onready = new Event();
	this.onupdate = new Event();
	this.ready = false;
	this.userName = null;
	this.authToken = null;

	this.pending = false;
	this.scheduled = false;

	ajax_get(DB_URL + "_session", this.sessionLoaded.bind(this));
}

UserStatus.prototype.sessionLoaded = function (result) {
	var session = JSON.parse(result);

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

UserStatus.prototype.userLoaded = function(result) {
	var user = JSON.parse(result);

	if (!user.imes) {
		user.imes = {};
	}
	if (!user.imes.authToken) {
		user.imes.authToken = this.generateAuthToken();
		ajax_post(DB_URL + "_users/org.couchdb.user:" + this.userName, user, this.userSaved.bind(this), this.userSavedError.bind(this), "PUT");
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

UserStatus.prototype.statusLoaded = function(result) {
	this.pending = false;
	var s = JSON.parse(result);
	this.status = s;
	this.onupdate.fire(this, s);
	this.schedule(5000);
}

UserStatus.prototype.statusLoadedError = function() {
	this.pending = false;
	this.schedule(30000);
}

UserStatus.prototype.trigger = function() {
	if (!this.pending) {
		this.pending = true;
		ajax_get(userStatus.backendUrl() + "status", this.statusLoaded.bind(this), this.statusLoadedError.bind(this));
	}
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
