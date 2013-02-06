var DB_URL = '/';
var DB_NAME = 'imes'; // %%%DB_NAME%%%
var BACKEND = 'http://127.0.0.1:9997'; /// %%%BACKEND%%%
var COUCH_SUFFIX = '\ufff0';

if (BACKEND.substring(BACKEND.length - 1) !== "/") {
	BACKEND += "/";
}

function _default_error_cb(url, xhr) {
	console.log("XHR error", xhr.status, xhr, url);
}

function ajax_get(url, cb, error) {
	error = error || _default_error_cb;
	var xhr = new XMLHttpRequest();
	xhr.open("GET", url, true);
	xhr.onreadystatechange = function() {
		if (xhr.readyState === 4) {
			if (xhr.status === 200) {
				cb(xhr.responseText);
			} else if (!xhr.aborted) {
				error(url, xhr);
			}
		}
	}
	xhr.send(null);
	return xhr;
}

function ajax_post(url, data, cb, error, method) {
	error = error || _default_error_cb;
	var xhr = new XMLHttpRequest();
	xhr.open(method || "POST", url, true);
	xhr.setRequestHeader("Content-Type", "application/json")
	xhr.onreadystatechange = function() {
		if (xhr.readyState === 4) {
			if (xhr.status === 200 || xhr.status === 201) {
				cb(xhr.responseText);
			} else {
				error(url, xhr);
			}
		}
	}
	xhr.send(JSON.stringify(data));
	return xhr;
}

function get_file_info(name, callback) {
	var extraArguments = Array.prototype.slice.call(arguments, 2);
	function cb(data) {
		callback.apply(this, extraArguments.concat([JSON.parse(data)]));
	}
	ajax_get(DB_URL + DB_NAME + "/" + encodeURIComponent(name), cb);
}

function ViewProxy(url, startkey, endkey, descending) {
	this.url = url;
	this.startkey = startkey;
	this.endkey = endkey;
	this.currentstartkey = startkey;
	this.skip = 0;
	this._url = url + "?include_docs=true&endkey=" + encodeURIComponent(JSON.stringify(this.endkey));
	if (descending) {
		this._url += "&descending=true";
	}

	this.clone = function() {
		return new ViewProxy(this.url, this.startkey, this.endkey);
	}

	this.reset = function() {
		this.currentstartkey = this.startkey;
		this.skip = 0;
	}

	this.fetch = function(callback, limit) {
		var me = this;
		var url = this._url;
		url += "&startkey=" + encodeURIComponent(JSON.stringify(this.currentstartkey));

		if (this.skip) {
			url += "&skip=" + this.skip;
		}

		if (limit) {
			url += "&limit=" + limit;
		}

		function cb(data) {
			var result = JSON.parse(data);
			var rows = result.rows;
			var skip = me.skip;
			var currentkey = me.currentstartkey;
			for (var i = 0; i < rows.length; i++) {
				var row = rows[i];
				if (row.key == currentkey) {
					skip += 1;
				} else {
					currentkey = row.key;
					skip = 1;
				}
			}
			me.skip = skip;
			me.currentstartkey = currentkey;
			var done = !limit || rows.length < limit;
			callback(rows, done);
		}

		if (descending && this.endkey === this.currentstartkey) {
			return cb('{"rows": []}');
		}

		ajax_get(url, cb);
	}
}

function ViewIterator(proxy, filter) {
	this.proxy = proxy;
	this.filter = filter;

	var filtered = filter ?
		function(rows) {
			var result = [];
			for (var i = 0; i < rows.length; i++) {
				if (filter(rows[i])) {
					result[result.length] = rows[i];
				} else {
				}
			}
			return result;
		}
		:
		function(rows) {
			return rows;
		};

	this.fetch = function(callback, limit) {
		function cb(rows, done) {
			callback(filtered(rows), done);
		}
		this.proxy.fetch(cb, limit);
	}
}

function plkey(plid, idx) {
	return plid + (16 + idx).toString(16);
}

function plkey_plid(plkey) {
	return plkey.substring(0, plkey.length - 2);
}

function plkey_idx(plkey) {
	return parseInt(plkey.substring(plkey.length - 2), 16) - 16;
}

function plid_range_low(plid) {
	return plid + "10";
}

function plid_range_high(plid) {
	return plid + "FF";
}

function PlaylistIterator(proxy, skip, reverse) {
	this.todo = [];
	this.done = false;
	this.proxy = proxy;
	if (reverse) {
		if (skip === 0) {
			proxy.skip = 1;
			skip = null;
		}
	}
	this.fetch = function(callback, limit) {
		var pending = {}, order = [], result = [], me = this;
		function cb2(plid, idx, value) {
			pending[plkey(plid, idx)] = value;
			while (order.length && pending.hasOwnProperty(order[0])) {
				var key = order.shift();
				result.push({"key": key, "value": pending[key]});
				delete pending[key];
			}
			if (!order.length) {
				callback(result, false);
			}
		}
		function getinfo() {
			for (var i = 0; i < limit && me.todo.length; i++) {
				var item = me.todo.shift();
				order.push(plkey(item.plid, item.idx));
				get_file_info(item.id, cb2, item.plid, item.idx);
			}
			if (!order.length) {
				callback([], true);
			}
		}
		function cb(rows, done) {
			for (var i = 0; i < rows.length; i++) {
				var items = rows[i].doc.items;
				if (reverse) {
					for (var j = skip === null ? items.length - 1: skip - 1; j >= 0; j--) {
						if (items[j]) {
							me.todo.push({id: items[j], plid: rows[i].doc._id, idx: j});
						}
					}
					skip = null;
				} else {
					for (var j = skip || 0; j < items.length; j++) {
						if (items[j]) {
							me.todo.push({id: items[j], plid: rows[i].doc._id, idx: j});
						}
					}
					skip = 0;
				}
			}
			if (done) {
				me.done = true;
			}
			getinfo();
		}
		if (this.done) {
			if (!this.todo.length) {
				return callback([], true);
			}
			getinfo();
		} else if (this.todo.length < limit) {
			this.proxy.fetch(cb, limit);
		} else {
			getinfo();
		}
	}
}

function PlaylistView(playlist, plid, idx) {
	var viewPrefix = DB_NAME + "/_all_docs/";

	var reverseEndkey = playlist + "/";
	var startkey = plid ? plid : playlist + "/";
	var endkey = playlist + "/z";

	this.getForwardIterator = function() {
		var proxy = new ViewProxy(DB_URL + viewPrefix, startkey, endkey);
		return new PlaylistIterator(proxy, idx, false);
	}

	this.getReverseIterator = function() {
		var proxy = new ViewProxy(DB_URL + viewPrefix, startkey, reverseEndkey, true);
		return new PlaylistIterator(proxy, idx, true);
	}
}

function Remote() {
	var viewPrefix = DB_NAME + "/_design/file/_view/";

	function lc(v) {
		return v.toLowerCase();
	}
	function eq(v) {
		return v;
	}
	var prefixes = {
		"artist": {view: "artist", transform: lc, range: COUCH_SUFFIX, mod: 3},
		"album": {view: "album", transform: lc, range: COUCH_SUFFIX, mod: 2},
		"title": {view: "title", transform: lc, range: COUCH_SUFFIX, mod: 1},
		"artist2": {view: "artist2", transform: eq, range: "", mod: 13},
		"album2": {view: "album2", transform: eq, range: "", mod: 12},
		"title2": {view: "title2", transform: eq, range: "", mod: 11},
		"all": {view: "search", transform: lc, range: COUCH_SUFFIX, mod: 0},
		"*": {view: "search", transform: lc, range: COUCH_SUFFIX, mod: 0}
	}

	function normalizeTerm(term) {
		var sep = term.indexOf(":");
		var k, v;
		if (sep >= 0) {
			k = term.substring(0, sep);
			v = term.substring(sep+1);
		} else {
			k = "*";
			v = term;
		}

		if (!prefixes.hasOwnProperty(k)) {
			k = "all";
			v = term;
		}
		v = decodeURI(v);
		if (!v.length) {
			return [-1, "search", ""];
		}
		var p = prefixes[k];
		return [v.length + p.mod, p.view, p.transform(v), p.range];
	}

	function _createFilter(spec, i0, i1) {
		var f = [];
		for (var i = i0; i < i1; i++) {
			f.push([spec[i][1], spec[i][2]]);
		}
		return createFilter(f);
	}

	this.getView = function(terms) {
		var terms = terms.split(/[ \t]+/);
		var temp = [];
		for (var i = 0; i < terms.length; i++) {
			var t = normalizeTerm(terms[i]);
			if (t[0] >= 0) {
				temp.push(t);
			}
		}
		if (!temp.length) {
			temp.push([0, "search", ""]);
		}
		temp.sort();
		var ps = temp[temp.length - 1];
		var proxy = new ViewProxy(DB_URL + viewPrefix + ps[1], ps[2], ps[2] + ps[3]);
		var filter = temp.length < 1 ? null : _createFilter(temp, 0, temp.length - 1);
		var result = new ViewIterator(proxy, filter);
		result.filter = _createFilter(temp, 0, temp.length);
		return result;
	}
}

function Subscription(config) {
	// http://localhost:5984/file/_changes?limit=1&since=60868&feed=longpoll
	this.url = DB_URL + DB_NAME + "/_changes";
	this.state = "failed";
	this.seq = null;
	this.xhr = null;
	this.args = {};
	this.ready = false;
	this.onready = new Event();
	this.onchange = new Event();
	this.config = config;

	/*
		initial state: preparing

		preparing  --[cancel]-> failed
		preparing  --[error]--> failed
		preparing  ---[ok]----> pending
		failed     -[prepare]-> preparing

		pending    --[start]--> processing
		processing --[cancel]-> pending
		processing ---[ok]----> waiting
		waiting    --[cancel]-> pending
		waiting    --[error]--> pending
		waiting    ---[ok]----> processing
	*/

	this.prepare();
}

Subscription.prototype.onReady = function(data) {
	var data = JSON.parse(data), config = this.config;
	this.seq = data.last_seq;
	this.state = "pending";
	this.ready = true;
	this.url += "?feed=longpoll";
	if (config.filter) {
		this.url += "&filter=" + config.filter;
	}
	if (config.timeout) {
		this.url += "&timeout=" + config.timeout;
	}
	if (config.heartbeat) {
		this.url += "&heartbeat=" + config.heartbeat;
	}
	if (config.limit) {
		this.url += "&limit=" + config.limit;
	}
	if (config.include_docs) {
		this.url += "&include_docs=" + config.include_docs;
	}
	this.onready.fire(this, this);
	this.start();
}

Subscription.prototype.onReadyError = function(url, xhr) {
	console.log("onReadyError", this.state, url, xhr);
	if (this.state !== "preparing") {
		return;
	}
	this.state = "failed";
	setTimeout(this.prepare.bind(this), 5000);
}

Subscription.prototype.onChange = function(data) {
	if (this.state !== "waiting") {
		return;
	}
	this.state = "processing";
	this.xhr = null;
	var data = JSON.parse(data);
	this.seq = data.last_seq;
	this.onchange.fire(this, data.results);
	this.poll();
}

Subscription.prototype.onChangeError = function(url, xhr) {
	console.log("onChangeError", this, this.state, url, xhr);
	if (this.state !== "waiting") {
		return;
	}
	this.state = "pending";
	this.xhr = null;
	setTimeout(this.poll.bind(this), 5000);
}

Subscription.prototype.getArguments = function() {
	var result = "";
	for (k in this.args) {
		if (this.args.hasOwnProperty(k)) {
			result += "&" + k + "=" + encodeURIComponent(this.args[k]);
		}
	}
	return result;
}

Subscription.prototype.poll = function() {
	if (this.state !== "processing") {
		console.log("???", this, this.state);
		//console.trace();
		throw ["illegal state (poll)", this.state];
	}
	this.state = "waiting";
	this.xhr = ajax_get(this.url + "&since=" + this.seq + this.getArguments(), this.onChange.bind(this), this.onChangeError.bind(this));
}


Subscription.prototype.cancel = function() {
	if (this.state === "preparing") {
		this.state = "failed";
	} else if (this.state === "processing" || this.state === "waiting") {
		this.state = "pending";
	}
}

Subscription.prototype.start = function() {
	if (this.state !== "pending") {
		throw ["illegal state (start)", this.state];
	}
	this.state = "processing";
	this.poll();
}

Subscription.prototype.updateArguments = function() {
	if (this.state === "waiting") {
		this.xhr.aborted = true;
		this.xhr.abort();
		this.state = "processing";
		this.poll();
	}
}

Subscription.prototype.prepare = function() {
	if (this.state !== "failed") {
		throw ["illegal state (prepare)", this.state];
	}
	this.state = "preparing";
	ajax_get(this.url + "?descending=true&limit=1", this.onReady.bind(this), this.onReadyError.bind(this));
}
