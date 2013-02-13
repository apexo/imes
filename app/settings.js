function Settings(userStatus) {
	this.userStatus = userStatus;
	this.lists = {};
	this.pending = [];
	this.onupdate = new Event();
	this.ready = false;

	if (this.userStatus.ready) {
		this.userReady();
	} else {
		this.userStatus.onready.addListener(this.userReady, this);
	}
	this.userStatus.onupdate.addListener(this.userUpdate, this);

	this.session_timeout = document.getElementById("session_timeout");
	this.session_timeout.addEventListener("change", this.setSessionTimeout.bind(this));
}

Settings.prototype.setSessionTimeout = function(event) {
	event.preventDefault();
	var value = this.session_timeout.value;
	console.log("setting session timeout", value);
	if (!value || value === "custom") {
		return;
	} else if (value === "default") {
		value = null;
	} else {
		value = parseInt(value);
	}
	console.log("setting session timeout, now really", value);
	this.userStatus.setSessionTimeout(value);
}

Settings.prototype.userUpdate = function(s) {
	function fmtTimespan(n) {
		if (n < 120) {
			return n + " seconds";
		} else if (n < 7200) {
			return Math.floor(n / 60 + 0.5) + " minutes";
		} else {
			return Math.floor(n / 3600 + 0.5) + " hours";
		}
	}

	this.session_timeout.disabled = false;
	if (s.session_timeout_default) {
		this.session_timeout.querySelector("[value=default]").textContent = "Default (" + fmtTimespan(s.session_timeout) + ")";
		this.session_timeout.value = "default";
	} else {
		this.session_timeout.value = "" + s.session_timeout;
		if (!this.session_timeout.value) {
			this.session_timeout.querySelector("[value=custom]").textContent = fmtTimespan(s.session_timeout);
			target.value = "custom";
		}
	}
}

Settings.prototype.setDelegateDevices = function(delegate, devices, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "delegate/" + delegate;
	ajax_post(url, {"devices": devices});
}

Settings.prototype.addDelegateDevice = function(delegate, devices, select, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "delegate/" + delegate;
	ajax_post(url, {"devices": devices.concat([select.value])});
}

Settings.prototype.setAggregateChannel = function(aggregate, select, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "aggregate/" + aggregate;
	ajax_post(url, {"channel": select.value});
}

Settings.prototype.setDeviceAggregate = function(device, select, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "device/" + device;
	ajax_post(url, {"aggregate": select.value});
}

Settings.prototype.setChannelPaused = function(channel, paused, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "channel/" + channel;
	ajax_post(url, {"paused": paused});
}

Settings.prototype.createLink = function(target, text, handler, confirm_text) {
	var a = target.appendChild(document.createElement("a"));
	a.href = "";
	a.appendChild(document.createTextNode(text));
	a.addEventListener("click", function(event) {
		if (confirm_text) {
			if (confirm("Are you sure you want to " + confirm_text + "?")) {
				return handler(event);
			} else {
				event.preventDefault();
			}
		} else {
			return handler(event);
		}
	}, false);
	return a;
}

Settings.prototype.authResult = function(result) {
	this.doUpdateCategory("scrobbler");

	if (result.substring(0, 6) === "error:") {
		alert(result);
	}
	if (result === true) {
		return;
	}
	console.log(result);
	if (result.substring(0, 7) === "http://" || result.substring(0, 8) === "https://") {
		var popup = document.getElementById("auth-link-popup");
		var target = document.getElementById("auth-link");
		target.href = result;
		target.innerHTML = "";
		target.appendChild(document.createTextNode(result));
		popup.style.display = "";
		return;
	}
	alert(result);
}

Settings.prototype.authScrobbler = function(network, event) {
	event.preventDefault();
	ajax_post(
		this.userStatus.backendUrl() + "scrobbler/" + network + "/auth",
		null, this.authResult.bind(this)
	);
}

Settings.prototype.confirmScrobbler = function(network, event) {
	event.preventDefault();
	ajax_post(
		this.userStatus.backendUrl() + "scrobbler/" + network + "/validate",
		null, this.authResult.bind(this)
	);
}

Settings.prototype.removeScrobbler = function(network, event) {
	event.preventDefault();
	ajax_post(
		this.userStatus.backendUrl() + "scrobbler/" + network + "/remove",
		null, this.authResult.bind(this)
	);
}

Settings.prototype.categories = {
	"scrobbler": {
		"target": "scrobblers",
		"format": function(item, target, data) {
			if (data && data.auth_token) {
				target.appendChild(document.createTextNode(": "));
				this.createLink(target, "auth", this.authScrobbler.bind(this, item));

				target.appendChild(document.createTextNode(", "));
				this.createLink(target, "confirm", this.confirmScrobbler.bind(this, item));

				target.appendChild(document.createTextNode(", "));
				this.createLink(target, "remove", this.removeScrobbler.bind(this, item));
			} else if (data && data.session_token) {
				target.appendChild(document.createTextNode(": "));
				this.createLink(target, "remove", this.removeScrobbler.bind(this, item));
			} else {
				target.appendChild(document.createTextNode(": "));
				this.createLink(target, "auth", this.authScrobbler.bind(this, item));
			}
		},
		"initial": true,
		"create": false
	},
	"channel": {
		"target": "channels",
		"format": function(item, target, data) {
			target.appendChild(document.createTextNode("; "));
			this.createLink(target, "pause", this.setChannelPaused.bind(this, item, true));

			target.appendChild(document.createTextNode("; "));
			this.createLink(target, "resume", this.setChannelPaused.bind(this, item, false));
		},
		"trigger": "aggregate",
		"initial": true
	},
	"aggregate": {
		"target": "aggregates",
		"format": function(item, target, data) {
			var ul = target.appendChild(document.createElement("ul"));
			var li = ul.appendChild(document.createElement("li"));
			li.appendChild(document.createTextNode("channel "));
			var select = li.appendChild(document.createElement("select"));
			this.createLink(li, "set", this.setAggregateChannel.bind(this, item, select));

			var channels = [""].concat(this.lists.channel);
			for (var i = 0; i < channels.length; i++) {
				var option = select.appendChild(document.createElement("option"));
				option.value = channels[i]
				if ((data.channel || "") === channels[i]) {
					option.selected = true;
				}
				option.appendChild(document.createTextNode(channels[i]));
			}

			this.aggregates[item] = {"channel": data.channel || ""};
		},
		"trigger": "device"
	},
	"device": {
		"target": "devices",
		"format": function(item, target, data) {
			var url = RTSP_BACKEND + "device/" + item + "/" + data.authToken;
			var url2 = DELEGATE_BACKEND + "device/" + item + "/" + data.authToken + "/stream.mp3";
			var ul = document.createElement("ul");
			var li = ul.appendChild(document.createElement("li"));
			li.appendChild(document.createTextNode(url));
			li = ul.appendChild(document.createElement("li"));
			li.appendChild(document.createTextNode(url2));
			li = ul.appendChild(document.createElement("li"));
			var select = li.appendChild(document.createElement("select"));
			this.createLink(li, "set", this.setDeviceAggregate.bind(this, item, select));

			var aggregates = [""].concat(this.lists.aggregate);
			for (var i = 0; i < aggregates.length; i++) {
				var option = select.appendChild(document.createElement("option"));
				option.appendChild(document.createTextNode(aggregates[i]));
				option.value = aggregates[i];
				if ((data.aggregate || "") === aggregates[i]) {
					option.selected = true;
				}
			}
			target.appendChild(ul);
		},
		"trigger": "delegate"
	},
	"delegate": {
		"target": "delegates",
		"format": function(item, target, data) {
			var url = DELEGATE_BACKEND + "delegate/" + item + "/" + data.authToken;
			var ul = target.appendChild(document.createElement("ul"));
			ul.appendChild(document.createElement("li")).appendChild(document.createTextNode(url + "/pause"));
			ul.appendChild(document.createElement("li")).appendChild(document.createTextNode(url + "/pause/$SECONDS"));
			ul.appendChild(document.createElement("li")).appendChild(document.createTextNode(url + "/unpause"));
			var otherDevices = this.lists.device.concat([]);
			for (var i = 0; i < data.devices.length; i++) {
				var dev = data.devices[i], rm = data.devices.concat([]), idx = otherDevices.indexOf(dev);
				rm.splice(i, 1);
				if (idx >= 0) {
					otherDevices.splice(idx, 1);
				}
				var li = ul.appendChild(document.createElement("li"));
				li.appendChild(document.createTextNode("device " + dev + "; "));
				this.createLink(li, "remove", this.setDelegateDevices.bind(this, item, rm));
			}
			if (otherDevices.length) {
				var li = ul.appendChild(document.createElement("li"));
				li.appendChild(document.createTextNode("device "));
				var select = li.appendChild(document.createElement("select"));
				this.createLink(li, "add", this.addDelegateDevice.bind(this, item, data.devices, select));
				for (var i = 0; i < otherDevices.length; i++) {
					var option = select.appendChild(document.createElement("option"));
					option.appendChild(document.createTextNode(otherDevices[i]));
					option.value = otherDevices[i];
				}
			}
		}
	}
}

Settings.prototype.userReady = function() {
	this.userStatus.onready.removeListener(this.userReady);
	subscription.onchange.addListener(this.onChange, this);
	this.doUpdateAll();
}

Settings.prototype.processResultList = function(category, list) {
	var target = this.categories[category].target ? document.getElementById(this.categories[category].target) : null;
	this.updateList(category, list, target);
}

Settings.prototype.doUpdateCategory = function(category) {
	this.pending.push(category);
	ajax_get(this.userStatus.backendUrl() + category, this.processResultList.bind(this, category));
}

Settings.prototype.doUpdateAll = function() {
	this.aggregates = {};
	this.ready = false;
	for (var k in this.categories) {
		if (this.categories.hasOwnProperty(k) && this.categories[k].initial) {
			this.doUpdateCategory(k);
		}
	}
}

Settings.prototype.onChange = function(changes) {
	for (var i = 0; i < changes.length; i++) {
		if (!changes[i].deleted && changes[i].id === "imes:state") {
			this.doUpdateAll();
			return;
		}
	}
}

Settings.prototype.removeElement = function(category, item, event) {
	event.preventDefault();
	ajax_get(this.userStatus.backendUrl() + category + "/" + item, null, {"method": "DELETE"});
}

Settings.prototype.updateItem = function(category, item, target, result) {
	target.appendChild(document.createTextNode(": "));
	this.createLink(target, "delete", this.removeElement.bind(this, category, item), "delete " + category + " " + item);
	this.categories[category].format.call(this, item, target, result);
}

Settings.prototype.queryItem = function(category, item, target) {
	ajax_get(this.userStatus.backendUrl() + category + "/" + item, this.updateItem.bind(this, category, item, target));
}

Settings.prototype.createElement = function(category, event) {
	event.preventDefault();
	var name = prompt("Enter name of new " + category);
	if (name) {
		if (!/^[a-z][-a-z0-9]*$/.test(name)) {
			alert("Illegal name: must start with a small letter (a-z) and may only contain small letters (a-z), digits (0-9) and hypens (-) after that");
			return;
		}
		ajax_post(this.userStatus.backendUrl() + category + "/" + name, "", null, {"method": "PUT"});
	}
}

Settings.prototype.updateList = function(category, items, target) {
	this.lists[category] = items;
	if (this.categories[category].trigger) {
		this.doUpdateCategory(this.categories[category].trigger);
	}
	var idx = this.pending.indexOf(category);
	if (idx >= 0) {
		this.pending.splice(idx, 1);
		if (!this.pending.length) {
			this.ready = true;
			this.onupdate.fire(this, this);
		}
	}

	target.innerHTML = "";
	var ul = document.createElement("ul");

	if (Array.isArray(items)) {
		for (var i = 0; i < items.length; i++) {
			var li = document.createElement("li");
			li.appendChild(document.createTextNode(items[i]));
			ul.appendChild(li);
			this.queryItem(category, items[i], li);
		}
	} else {
		for (var item in items) {
			if (items.hasOwnProperty(item)) {
				var li = document.createElement("li");
				li.appendChild(document.createTextNode(item));
				ul.appendChild(li);
				this.categories[category].format.call(this, item, li, items[item]);
			}
		}
	}

	if (this.categories[category].create !== false) {
		var li = document.createElement("li");
		this.createLink(li, "create", this.createElement.bind(this, category));
		ul.appendChild(li);
	}

	target.appendChild(ul);
}
