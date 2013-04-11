function Settings(userStatus) {
	this.userStatus = userStatus;
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

	this.bindings = {
		"state": [],
		"scrobblers": []
	}

	for (var category in this.categories) {
		if (this.categories.hasOwnProperty(category)) {
			this.createInitial(category, document.getElementById(this.categories[category].target));
		}
	}
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

Settings.prototype.addDelegateDevice = function(delegate, select, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "delegate/" + delegate;
	var devices = this.delegates[delegate].devices;
	ajax_post(url, {"devices": devices.concat([select.value])});
}

Settings.prototype.removeDelegateDevice = function(delegate, name, event) {
	event.preventDefault();
	var url = this.userStatus.backendUrl() + "delegate/" + delegate;
	var devices = this.delegates[delegate].devices.concat([]);
	var idx = devices.indexOf(name);
	if (idx >= 0) {
		devices.splice(idx, 1);
		ajax_post(url, {"devices": devices});
	}
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
	this.doUpdateScrobblers();

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

Settings.prototype.createPlayer = function(target, url, event) {
	event.preventDefault();
	var t = event.target, p = t.parentElement;
	p.removeChild(t.previousSibling);
	p.removeChild(t);
	var li = document.createElement("li");
	p.parentElement.appendChild(li);
	var a = document.createElement("audio");
	a.autoplay = true;
	a.controls = true;
	a.src = url;
	li.appendChild(a);
}

Settings.prototype.categoryItemStub = function(item) {
	var li = document.createElement("li");
	li.appendChild(document.createTextNode(item));
	li.dataset.key = item;
	return li;
}

Settings.prototype.deferExpand = function(item, callback) {
	var target = this.categoryItemStub(item);
	var expand = target.appendChild(document.createElement("span"));
	expand.appendChild(document.createTextNode(" ▽"));
	expand.classList.add("button");

	expand.addEventListener("click", function() {
		target.removeChild(expand);
		callback.call(this, target);
	}.bind(this));

	return target;
}

Settings.prototype.updateList = function(list, firstElement, lastElement, items, create) {
	lastElement = lastElement || null;

	var i = 0, len = items.length, current = firstElement;
	while (current != lastElement || i < len) {
		if (i >= len || current !== lastElement && current.dataset.key < items[i]) {
			var next = current.nextElementSibling;
			list.removeChild(current);
			current = next;
		} else if (current === lastElement || items[i] < current.dataset.key) {
			var newItem = create(items[i]);
			newItem.dataset.key = items[i];
			list.insertBefore(newItem, current);
			i++;
		} else {
			current = current.nextElementSibling;
			i++;
		}
	}
}

Settings.prototype.deleteLink = function(item, category, target) {
	this.createLink(target, "delete", this.removeElement.bind(this, category, item), "delete " + category + " " + item);
}

Settings.prototype.bind = function(group, dataFn, keyFn, updateFn) {
	var data = dataFn.call(this);
	if (data) {
		var key = keyFn.call(this, data);
		updateFn.call(this, data);

		var id = this.bindings[group].length;
		this.bindings[group][id] = {
			data: dataFn,
			key: keyFn,
			update: updateFn,
			lastKey: key
		};
	}
}

Settings.prototype.updateBindings = function(group) {
	var bindings = this.bindings[group];

	for (var i = 0; i < bindings.length; i++) {
		var b = bindings[i];
		var data = b.data.call(this);
		if (data) {
			var key = b.key.call(this, data);
			if (key !== b.lastKey) {
				b.update.call(this, data);
				b.lastKey = key;
			}
		} else {
			if (i < bindings.length - 1) {
				bindings[i] = bindings[bindings.length - 1];
				i--;
			}
			bindings.length--;
		}
	}
}

Settings.prototype.categories = {
	"scrobbler": {
		"target": "scrobblers",
		"format": function(item) {
			var target = this.categoryItemStub(item);
			var lastStatic = target.appendChild(document.createTextNode(": "));

			this.bind("scrobblers",
				function() { return this.scrobblers[item]; },
				function(data) { return data && (data.auth_token + "\0" + data.session_token); },
				function(data) {
					var node = lastStatic;
					while (node.nextSibling) {
						target.removeChild(target.lastChild);
					}

					if (data && data.auth_token) {
						this.createLink(target, "auth", this.authScrobbler.bind(this, item));
						target.appendChild(document.createTextNode(", "));
						this.createLink(target, "confirm", this.confirmScrobbler.bind(this, item));
						target.appendChild(document.createTextNode(", "));
						this.createLink(target, "remove", this.removeScrobbler.bind(this, item));
					} else if (data && data.session_token) {
						this.createLink(target, "remove", this.removeScrobbler.bind(this, item));
					} else {
						this.createLink(target, "auth", this.authScrobbler.bind(this, item));
					}
				}
			);

			return target;
		},
		"create": false
	},
	"channel": {
		"target": "channels",
		"format": function(item, target, data) {
			return this.deferExpand(item, function(target) {
				target.appendChild(document.createTextNode(": "));
				this.deleteLink(item, "channel", target);

				target.appendChild(document.createTextNode("; "));
				this.createLink(target, "pause", this.setChannelPaused.bind(this, item, true));

				target.appendChild(document.createTextNode("; "));
				this.createLink(target, "resume", this.setChannelPaused.bind(this, item, false));
			});
		}
	},
	"aggregate": {
		"target": "aggregates",
		"format": function(item) {
			return this.deferExpand(item, function(target) {
				target.appendChild(document.createTextNode(": "));
				this.deleteLink(item, "aggregate", target);
				var data = this.aggregates[item];

				var ul = target.appendChild(document.createElement("ul"));
				var li = ul.appendChild(document.createElement("li"));
				li.appendChild(document.createTextNode("channel"));

				var select = li.appendChild(document.createElement("select"));
				select.classList.add("select-channel");
				this.updateOptionLists([select], this.channels);

				this.createLink(li, "set", this.setAggregateChannel.bind(this, item, select));

				this.bind("state",
					function() { return this.aggregates[item]; },
					function(data) { return data.channel || ""; },
					function(data) { select.value = data.channel || ""; }
				);
			});
		}
	},
	"device": {
		"target": "devices",
		"format": function(item, target, data) {
			return this.deferExpand(item, function(target) {
				target.appendChild(document.createTextNode(": "));
				this.deleteLink(item, "device", target);
				var data = this.devices[item];

				var ul = document.createElement("ul");
				var li = ul.appendChild(document.createElement("li"));
				var url1 = li.appendChild(document.createTextNode(""));
				li = ul.appendChild(document.createElement("li"));
				var url2 = li.appendChild(document.createTextNode(""));
				li.appendChild(document.createTextNode("; "));

				var open = li.appendChild(document.createElement("a"));
				open.target = "_blank";
				open.appendChild(document.createTextNode("open"));

				this.bind("state",
					function() { return this.devices[item]; },
					function(data) { return data.authToken; },
					function(data) {
						var u1 = RTSP_BACKEND + "device/" + item + "/" + data.authToken;
						var u2 = DELEGATE_BACKEND + "device/" + item + "/" + data.authToken + "/stream.mp3";
						url1.textContent = u1;
						url2.textContent = u2;
						open.href = u2;
					}
				);

				li = ul.appendChild(document.createElement("li"));
				li.appendChild(document.createTextNode("aggregate"));

				var select = li.appendChild(document.createElement("select"));
				select.classList.add("select-aggregate");
				this.updateOptionLists([select], this.aggregates);

				this.bind("state",
					function() { return this.devices[item]; },
					function(data) { return data.aggregate || ""; },
					function(data) { select.value = data.aggregate || ""; }
				);

				this.createLink(li, "set", this.setDeviceAggregate.bind(this, item, select));

				target.appendChild(ul);
			});
		}

	},
	"delegate": {
		"target": "delegates",
		"format": function(item, target, data) {
			return this.deferExpand(item, function(target) {
				target.appendChild(document.createTextNode(": "));
				this.deleteLink(item, "delegate", target);
				var data = this.delegates[item];

				var url = DELEGATE_BACKEND + "delegate/" + item + "/" + data.authToken;
				var ul = target.appendChild(document.createElement("ul"));
				var t1 = ul.appendChild(document.createElement("li")).appendChild(document.createTextNode(""));
				var t2 = ul.appendChild(document.createElement("li")).appendChild(document.createTextNode(""));
				var t3 = ul.appendChild(document.createElement("li")).appendChild(document.createTextNode(""));
				var lastURL = t3.parentElement;
				var selectLi = ul.appendChild(document.createElement("li"));
				selectLi.appendChild(document.createTextNode("device "));
				var select = selectLi.appendChild(document.createElement("select"));
				this.createLink(selectLi, "add", this.addDelegateDevice.bind(this, item, select));

				this.bind("state",
					function() { return this.delegates[item]; },
					function(data) { return data.authToken; },
					function(data) {
						var url = DELEGATE_BACKEND + "delegate/" + item + "/" + data.authToken;
						t1.textContent = url + "/pause";
						t2.textContent = url + "/pause/$SECONDS";
						t3.textContent = url + "/unpause";
					}
				);

				this.bind("state",
					function() {
						var d = this.delegates[item];
						return d && {
							"delegateDevices": d.devices,
							"allDevices": this.arrayify(this.devices).sort()
						}
					}.bind(this),
					function(data) {
						return JSON.stringify(data.delegateDevices) + "\0" + JSON.stringify(data.allDevices);
					},
					function(data) {
						var i = 0;
						var deviceLi = lastURL.nextSibling;

						this.updateList(ul, lastURL.nextSibling, selectLi, data.delegateDevices, function(name) {
							var newItem = document.createElement("li");
							newItem.dataset.key = data.delegateDevices[i];
							newItem.appendChild(document.createTextNode("device " + name + "; "));
							this.createLink(newItem, "remove", this.removeDelegateDevice.bind(this, item, name));
							return newItem;
						}.bind(this));

						var otherDevices = [];
						for (var i = 0; i < data.allDevices.length; i++) {
							if (data.delegateDevices.indexOf(data.allDevices[i]) == -1) {
								otherDevices.push(data.allDevices[i]);
							}
						}

						this.updateList(select, select.firstElementChild, null, otherDevices, function(name) {
							var option = document.createElement("option");
							option.appendChild(document.createTextNode(name));
							option.value = name;
							return option;
						}.bind(this));

						selectLi.style.display = otherDevices.length ? "" : "none";
					}
				);
			});
		}
	}
}

Settings.prototype.userReady = function() {
	this.userStatus.onready.removeListener(this.userReady);
	subscription.onchange.addListener(this.onChange, this);
	this.doUpdateAll();
}

Settings.prototype.doUpdateScrobblers = function() {
	if (this.scrobblers_xhr) {
		ajax_abort(this.scrobblers_xhr);
		this.scrobblers_xhr = null;
	}

	this.scrobblers_xhr = ajax_get(this.userStatus.backendUrl() + "scrobbler", function(data) {
		this.scrobblers_xhr = null;
		var target = document.getElementById(this.categories.scrobbler.target);
		this.scrobblers = data;
		this.updateBindings("scrobblers");
		this.updateCategoryList("scrobbler", data, target);
	}.bind(this));

}

Settings.prototype.doUpdateState = function() {
	if (this.state_xhr) {
		ajax_abort(this.state_xhr);
		this.state_xhr = null;
	}

	this.state_xhr = ajax_get(DB_URL + DB_NAME + "/imes:state", function(data) {
		this.state_xhr = null;
		this.onStateUpdate(data);
	}.bind(this));
}

Settings.prototype.doUpdateAll = function() {
	this.doUpdateScrobblers();
	this.doUpdateState();
}

Settings.prototype.onChange = function(changes) {
	for (var i = 0; i < changes.length; i++) {
		if (!changes[i].deleted && changes[i].id === "imes:state") {
			console.log("settings update:", changes[i]);
			this.onStateUpdate(changes[i].doc);
			return;
		}
	}
}

Settings.prototype.onStateUpdate = function(doc) {
	this.aggregates = doc.aggregates;
	this.channels = doc.channels;
	this.delegates = doc.delegates;
	this.devices = doc.devices;
	this.updateBindings("state");
	this.updateCategoryList("aggregate", this.aggregates, document.getElementById(this.categories.aggregate.target));
	this.updateCategoryList("channel", this.channels, document.getElementById(this.categories.channel.target));
	this.updateCategoryList("device", this.devices, document.getElementById(this.categories.device.target));
	this.updateCategoryList("delegate", this.delegates, document.getElementById(this.categories.delegate.target));
	this.updateOptionLists(document.getElementsByClassName("select-channel"), this.channels);
	this.updateOptionLists(document.getElementsByClassName("select-aggregate"), this.aggregates);
	this.ready = true;
	this.onupdate.fire(this, this);
}

Settings.prototype.removeElement = function(category, item, event) {
	event.preventDefault();
	ajax_get(this.userStatus.backendUrl() + category + "/" + item, null, {"method": "DELETE"});
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

Settings.prototype.createInitial = function(category, target) {
	if (this.categories[category].create !== false) {
		var li = document.createElement("li");
		this.createLink(li, "create", this.createElement.bind(this, category));
		target.appendChild(li);
	}
}

Settings.prototype.listProperties = function(v) {
	var temp = [];
	for (var k in v) {
		if (v.hasOwnProperty(k)) {
			temp.push(k);
		}
	}
	return temp;
}

Settings.prototype.arrayify = function(v) {
	if (Array.isArray(v)) {
		return v;
	}
	return this.listProperties(v);
}

Settings.prototype.updateOptionLists = function(lists, values) {
	values = [""].concat(this.arrayify(values).sort());
	for (var j = 0; j < lists.length; j++) {
		var list = lists[j];
		var lastValue = list.value;
		var i = 0;
		var option = list.firstElementChild;
		this.updateList(list, list.firstElementChild, null, values, function(name) {
			var newOption = document.createElement("option");
			newOption.appendChild(document.createTextNode(name));
			newOption.value = name;
			return newOption;
		});
		if (lastValue !== list.value) {
			console.log("list value changed unexpectedly", list, lastValue, "->", list.value);
		}
	}
}

Settings.prototype.updateCategoryList = function(category, values, list) {
	values = this.arrayify(values).sort();
	var i = 0;
	var item = list.firstElementChild;
	while (item && !item.dataset.key) {
		item = item.nextElementSibling;
	}
	this.updateList(list, item, null, values, function(name) {
		return this.categories[category].format.call(this, name);
	}.bind(this));
}
