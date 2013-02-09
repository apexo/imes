var DOMNotification = (function() {
if (window.Notification) {
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

	return DOMNotification;
} else {
	function DOMNotificationUnsupported() {
		this.onready = new Event();
		this.permission = "unsupported";
	}

	DOMNotificationUnsupported.prototype.requestPermission = function() {
		this.onready.fire(this, "unsupported");
	}

	DOMNotificationUnsupported.prototype.nowPlaying = function(info) {
	}

	return DOMNotificationUnsupported;
}
})();
