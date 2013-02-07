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
}

Settings.prototype.setDelegateDevices = function(delegate, devices, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "delegate/" + delegate;
	ajax_post(url, {"devices": devices}, function() {});
}

Settings.prototype.addDelegateDevice = function(delegate, devices, select, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "delegate/" + delegate;
	ajax_post(url, {"devices": devices.concat([select.value])}, function() {});
}

Settings.prototype.setAggregateChannel = function(aggregate, select, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "aggregate/" + aggregate;
	ajax_post(url, {"channel": select.value}, function() {});
}

Settings.prototype.setDeviceAggregate = function(device, select, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "device/" + device;
	ajax_post(url, {"aggregate": select.value}, function() {});
}

Settings.prototype.setChannelPaused = function(channel, paused, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "channel/" + channel;
	ajax_post(url, {"paused": paused}, function() {});
}

Settings.prototype.createLink = function(target, text, handler) {
	var a = target.appendChild(document.createElement("a"));
	a.href = "";
	a.appendChild(document.createTextNode(text));
	a.addEventListener("click", handler, false);
	return a;
}

Settings.prototype.authResult = function(result) {
	this.doUpdateCategory("scrobbler");

	var result = JSON.parse(result);

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
			var a = target.appendChild(document.createElement("a"));
			a.appendChild(document.createTextNode("pause"));
			a.href = "";
			a.addEventListener("click", this.setChannelPaused.bind(this, item, true), false);
			target.appendChild(document.createTextNode("; "));
			var a = target.appendChild(document.createElement("a"));
			a.appendChild(document.createTextNode("resume"));
			a.href = "";
			a.addEventListener("click", this.setChannelPaused.bind(this, item, false), false);
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
			var a = li.appendChild(document.createElement("a"));
			a.appendChild(document.createTextNode("set"));
			a.href = "";
			a.addEventListener("click", this.setAggregateChannel.bind(this, item, select), false);

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
			var ul = document.createElement("ul");
			var li = ul.appendChild(document.createElement("li"));
			li.appendChild(document.createTextNode(url));
			li = ul.appendChild(document.createElement("li"));
			var select = li.appendChild(document.createElement("select"));
			var aggregates = [""].concat(this.lists.aggregate);
			for (var i = 0; i < aggregates.length; i++) {
				var option = select.appendChild(document.createElement("option"));
				option.appendChild(document.createTextNode(aggregates[i]));
				option.value = aggregates[i];
				if ((data.aggregate || "") === aggregates[i]) {
					option.selected = true;
				}
			}
			var a = li.appendChild(document.createElement("a"));
			a.appendChild(document.createTextNode("set"));
			a.href = "";
			a.addEventListener("click", this.setDeviceAggregate.bind(this, item, select), false);
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
				var a = li.appendChild(document.createElement("a"));
				a.appendChild(document.createTextNode("remove"));
				a.href = "";
				a.addEventListener("click", this.setDelegateDevices.bind(this, item, rm), false);
			}
			if (otherDevices.length) {
				var li = ul.appendChild(document.createElement("li"));
				li.appendChild(document.createTextNode("device "));
				var select = li.appendChild(document.createElement("select"));
				var a = li.appendChild(document.createElement("a"));
				a.appendChild(document.createTextNode("add"));
				a.href = "";
				a.addEventListener("click", this.addDelegateDevice.bind(this, item, data.devices, select), false);
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

Settings.prototype.processResultList = function(category, result) {
	var
		list = JSON.parse(result),
		target = document.getElementById(this.categories[category].target);
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
	ajax_post(this.userStatus.backendUrl() + category + "/" + item, "", function() {}, null, "DELETE");
}

Settings.prototype.updateItem = function(category, item, target, result) {
	target.appendChild(document.createTextNode(": "));
	var remove = document.createElement("a");
	remove.href = "";
	remove.addEventListener("click", this.removeElement.bind(this, category, item), false);
	remove.appendChild(document.createTextNode("delete"));
	target.appendChild(remove);
	this.categories[category].format.call(this, item, target, JSON.parse(result));
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
		ajax_post(this.userStatus.backendUrl() + category + "/" + name, "", function() {}, null, "PUT")
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
		var create = document.createElement("a");
		create.href = "";
		create.addEventListener("click", this.createElement.bind(this, category), false);
		create.appendChild(document.createTextNode("create"));
		var li = document.createElement("li");
		li.appendChild(create);
		ul.appendChild(li);
	}

	target.appendChild(ul);
}
