function UserStatus() {
	this.onready = new Event();
	this.ready = false;
	this.userName = null;
	this.authToken = null;

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
}

UserStatus.prototype.backendUrl = function() {
	return BACKEND + "user/" + this.userName + "/" + this.authToken + "/";
}
