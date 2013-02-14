var DOMNotification = (function() {
	function DOMNotification() {
		this.onready = new Event();
		this.permission = "default";
		this.pending = false;
		this.timeout = 5000;
		this._nowPlaying = null;

		// chrome actually seems to display only 32x32 :-(
		this.iconWidth = 64;
		this.iconHeight = 64;
	}

	DOMNotification.prototype.requestPermission = function() {
		if (this.permission === "default" && !this.pending) {
			this.pending = true;
			Notification.requestPermission(this.requestPermissionCallback.bind(this));
		}
	}

	DOMNotification.prototype.requestPermissionCallback = function(value) {
		console.log("result", arguments);
		this.pending = false;
		this.permission = value;
		if (value === "granted") {
			this.onready.fire(this, value);
		}
	}

	DOMNotification.prototype.nowPlaying = function(info) {
		if (!info) {
			if (this._nowPlaying) {
				this._nowPlaying.cancel();
				this._nowPlaying = null;
			}
			return;
		}

		var options = {"tag": "now-playing"};
		
		var title;
		if (info.artist && info.artist.length) {
			options.body = info.artist[0];
		}

		if (info.title && info.title.length) {
			title = info.title[0];
		} else {
			title = "[Unknown Title]";
		}

		var cover = selectPicture(info, this.iconWidth, this.iconHeight, THUMB_TYPE);
		if (cover) {
			options.icon = window.location.protocol + "//" + window.location.host + cover.src;
		}

		var notification = new Notification(title, options);
		this._nowPlaying = notification;

		setTimeout(function() {
			if (this._nowPlaying === notification) {
				this._nowPlaying.cancel();
				this._nowPlaying = null;
			}
		}.bind(this), this.timeout);
	}


	function WebkitNotification() {
		this.onready = new Event();
		this.permission = "default";
		this.pending = false;
		this.timeout = 5000;
		this._nowPlaying = null;

		// chrome actually seems to display only 32x32 :-(
		this.iconWidth = 64;
		this.iconHeight = 64;
	}

	WebkitNotification.prototype.query = function() {
		var p = webkitNotifications.checkPermission();
		return ["granted", "default", "denied"][p];
	}

	WebkitNotification.prototype.requestPermission = function() {
		if (this.permission !== "default" || this.pending) {
			return;
		}
		this.permission = this.query()
		/*if (this.permission !== "default") {
			this.requestPermissionCallback(this.permission);
		}*/
		this.pending = true;
		webkitNotifications.requestPermission(this.requestPermissionCallback.bind(this));
	}

	WebkitNotification.prototype.requestPermissionCallback = function(value) {
		var value = value || this.query();
		this.pending = false;
		this.permission = value;
		if (value === "granted" || value === "denied") {
			this.onready.fire(this, value);
		}
	}

	WebkitNotification.prototype.nowPlaying = function(info) {
		if (this._nowPlaying) {
			this._nowPlaying.cancel();
			this._nowPlaying = null;
		}
		if (!info) {
			return;
		}

		var body = info.artist && info.artist.length ? info.artist[0] : "";
		var title = info.title && info.title.length ? info.title[0] : "[Unknown Title]";
		var cover = selectPicture(info, this.iconWidth, this.iconHeight, THUMB_TYPE);
		var icon = cover ? window.location.protocol + "//" + window.location.host + cover.src : "";

		var notification = webkitNotifications.createNotification(icon, title, body);
		notification.show();
		this._nowPlaying = notification;

		setTimeout(function() {
			if (this._nowPlaying === notification) {
				this._nowPlaying.cancel();
				this._nowPlaying = null;
			}
		}.bind(this), this.timeout);
	}

	function DOMNotificationUnsupported() {
		this.onready = new Event();
		this.permission = "unsupported";
	}

	DOMNotificationUnsupported.prototype.requestPermission = function() {
		this.onready.fire(this, "unsupported");
	}

	DOMNotificationUnsupported.prototype.nowPlaying = function(info) {
	}


if (window.webkitNotifications) {
	return WebkitNotification;
}

if (window.Notification) {
	return DOMNotification;
}

return DOMNotificationUnsupported;
})();
