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

UserStatus.prototype.userLoaded = function(result) {
	var user = JSON.parse(result);

	if (!user.imes || !user.imes.authToken) {
		alert("could not retrieve auth token");
		return;
	}

	this.authToken = user.imes.authToken;

	this.ready = true;
	this.onready.fire(this, this);
	queryStatus();
}

UserStatus.prototype.backendUrl = function() {
	return BACKEND + "user/" + this.userName + "/" + this.authToken + "/";
}
