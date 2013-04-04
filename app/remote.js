var DB_URL = '/';
var DB_NAME = 'imes'; // %%%DB_NAME%%%
var BACKEND = 'http://127.0.0.1:9997'; /// %%%BACKEND%%%
var RTSP_BACKEND = 'rtsp://127.0.0.1:9997'; /// %%%RTSP_BACKEND%%%
var DELEGATE_BACKEND = 'http://127.0.0.1:9997'; /// %%%DELEGATE_BACKEND%%%
var COUCH_SUFFIX = '\ufff0';

if (BACKEND.substring(BACKEND.length - 1) !== "/") {
	BACKEND += "/";
}

if (RTSP_BACKEND.substring(RTSP_BACKEND.length - 1) !== "/") {
	RTSP_BACKEND += "/";
}

if (DELEGATE_BACKEND.substring(DELEGATE_BACKEND.length - 1) !== "/") {
	DELEGATE_BACKEND += "/";
}

function _default_error_cb(url, xhr) {
	console.log("XHR error", xhr.status, xhr, url);
}

function _ajax_retry(url, config, xhr) {
	console.log("XHR error for request on", url, ": ", xhr, "; config: ", config);
	if (config.retryDelay && config.retry !== false) {
		console.log("retrying in ", config.retryDelay);
		setTimeout(function() {
			if (xhr.aborted) {
				console.log("request for ", url, "aborted before retry");
			} else {
				_ajax_common(url, config._rawData, config._cb, config);
			}
		}, config.retryDelay);
	}
}

var AJAX_GET_DEFAULT_CONFIG = {
	"method": "GET",
	"error": _ajax_retry,
	"jsonResponse": true,
	"headers": {},
	"retryDelay": 10000,
	"timeout": 20000
}

var AJAX_POST_DEFAULT_CONFIG = {
	"method": "POST",
	"error": _ajax_retry,
	"jsonResponse": true,
	"jsonRequest": true,
	"headers": {
		"Content-Type": "application/json"
	},
	"retryDelay": 10000,
	"timeout": 20000
}

function apply_defaults(defaults, config) {
	var result = {};
	for (var k in defaults) {
		if (defaults.hasOwnProperty(k)) {
			result[k] = defaults[k];
		}
	}
	if (!config) {
		return result;
	}
	for (var k in config) {
		if (config.hasOwnProperty(k)) {
			result[k] = config[k];
		}
	}
	return result;
}

function _ajax_common(url, rawData, cb, config) {
	if (config._rawData === undefined) {
		config._rawData = rawData;
		config._cb = cb;
	}

	var xhr = new XMLHttpRequest();
	xhr.open(config.method, url, true);
	for (var k in config.headers) {
		if (config.headers.hasOwnProperty(k)) {
			xhr.setRequestHeader(k, config.headers[k]);
		}
	}
	xhr.onreadystatechange = function() {
		if (xhr.readyState !== 4) {
			if (xhr.aborted) {
				console.log(xhr);
				alert("aborted with readyState != 4: " + xhr);
			}
			return;
		}
		if (xhr._timeout !== null) {
			clearTimeout(xhr._timeout);
		}
		if (xhr.aborted) {
			return;
		} else if (xhr.status === 404) {
			cb(null);
		}
		else if (xhr.status === 200 || xhr.status === 201) {
			var response;
			if (config.jsonResponse) {
				try {
					response = JSON.parse(xhr.responseText);
				}
				catch (e) {
					console.trace();
					console.log("JSON parse error", e, typeof e);
					config.error(url, config, xhr);
					return;
				}
			} else {
				response = xhr.responseText;
			}
			if (cb) {
				cb(response);
			}
		} else {
			config.error(url, config, xhr);
		}
	}
	xhr.send(rawData);
	if (config._origXhr === undefined) {
		config._origXhr = xhr;
	} else {
		config._origXhr._retry = xhr;
	}
	if (config.timeout) {
		xhr._timeout = setTimeout(function() {
			if (xhr.aborted || xhr.readyState === 4) {
				console.log("XHR already aborted / done when timeout hit", xhr.aborted, xhr.readyState);
				return;
			}
			console.log("timeout on", xhr);
			xhr._timeout = null,
			ajax_abort(xhr);
			xhr.aborted = false;
			config.error(url, config, xhr);
		}, config.timeout);
	} else {
		xhr._timeout = null;
	}
	return xhr;
}

function ajax_get(url, cb, config) {
	config = apply_defaults(AJAX_GET_DEFAULT_CONFIG, config);

	return _ajax_common(url, null, cb, config);
}

function ajax_post(url, data, cb, config) {
	config = apply_defaults(AJAX_POST_DEFAULT_CONFIG, config);

	data = config.jsonRequest ? JSON.stringify(data) : data;

	return _ajax_common(url, data, cb, config);
}

function ajax_abort(xhr) {
	if (xhr._retry) {
		xhr._retry.aborted = true;
		xhr._retry.abort();
	} else {
		xhr.aborted = true;
		xhr.abort();
	}
}

function get_file_info(name, callback) {
	var extraArguments = Array.prototype.slice.call(arguments, 2);
	function cb(data) {
		if (!data) {
			data = {"_deleted": true, "_id": name};
		}
		callback.apply(this, extraArguments.concat([data]));
	}
	return ajax_get(DB_URL + DB_NAME + "/" + encodeURIComponent(name), cb);
}

function ViewProxy(url, startkey, endkey, descending, docid) {
	this.url = url;
	this.startkey = startkey;
	this.endkey = endkey;
	this.currentstartkey = startkey;
	this.skip = 0;
	this._url = url + "?include_docs=true"
	if (this.endkey !== undefined && this.endkey !== null) {
		this._url += "&endkey=" + encodeURIComponent(JSON.stringify(this.endkey));
	}
	if (descending) {
		this._url += "&descending=true";
	}
	this.xhr = null;

	this.clone = function() {
		return new ViewProxy(this.url, this.startkey, this.endkey, descending, docid);
	}

	this.reset = function() {
		this.currentstartkey = this.startkey;
		this.skip = 0;
	}

	this.fetch = function(callback, limit) {
		var me = this;
		var url = this._url;
		if (this.currentstartkey !== undefined && this.currentstartkey !== null) {
			url += "&startkey=" + encodeURIComponent(JSON.stringify(this.currentstartkey));
		}

		if (this.skip) {
			url += "&skip=" + this.skip;
		}

		if (limit) {
			url += "&limit=" + limit;
		}

		function cb(result) {
			var rows = result.rows;
			var skip = me.skip;
			var currentkey = me.currentstartkey;
			for (var i = 0; i < rows.length; i++) {
				var row = rows[i];
				if (docid && !descending) {
					currentkey = row.id + "X";
					skip = 0;
				} else if (row.key == currentkey) {
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
			return cb({"rows": []});
		}

		this.xhr = ajax_get(url, cb);
	}

	this.abort = function() {
		if (this.xhr) {
			ajax_abort(this.xhr);
			this.xhr = null;
		}
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
					result.push(rows[i]);
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
	this.abort = function() {
		this.proxy.abort();
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

var pl_limit = 0xFF - 0x10 + 1;

function PlaylistIterator(proxy, startkey, skip, reverse) {
	this.queue = [];
	this.done = false;
	this.proxy = proxy;
	this.limit = null;
	this.callback = null;
	this.startkey = startkey;
	this.skip = skip;
	this.reverse = reverse;

	this.pending = {};
	this.expectedOrder = [];
	this.unorderedResults = {};
	this.orderedResults = [];

	this.orderResults = function() {
		while (this.expectedOrder.length && this.unorderedResults.hasOwnProperty(this.expectedOrder[0])) {
			var key = this.expectedOrder.shift();
			this.orderedResults.push({"key": key, "value": this.unorderedResults[key]});
			delete this.unorderedResults[key];
		}

		if (!this.expectedOrder.length) {
			this.callback(this.orderedResults.splice(0), false);
		}
	}

	this.cb2 = function(key, value) {
		if (!this.expectedOrder.length) {
			console.log("illegal state");
			console.trace();
			return;
		}

		delete this.pending[key];
		this.unorderedResults[key] = value;

		this.orderResults();
	}

	this.getinfo = function() {
		for (var i = 0; i < this.limit && this.queue.length; i++) {
			var item = this.queue.shift();
			var xhr = get_file_info(item.id, this.cb2.bind(this), item.key);
			this.pending[item.key] = xhr;
			this.expectedOrder.push(item.key);
		}
		if (!this.expectedOrder.length) {
			this.callback([], this.done);
		}
	}

	this.cb = function(rows, done) {
		for (var i = 0; i < rows.length; i++) {
			var items = rows[i].doc.items;
			if (this.reverse) {
				for (var j = rows[i].doc._id === this.startkey ? this.skip - 1 : items.length - 1; j >= 0; j--) {
					if (items[j]) {
						this.queue.push({id: items[j], key: plkey(rows[i].doc._id, j)});
					}
				}
			} else {
				for (var j = rows[i].doc._id === this.startkey ? this.skip : 0; j < items.length; j++) {
					if (items[j]) {
						this.queue.push({id: items[j], key: plkey(rows[i].doc._id, j)});
					}
				}
			}
		}
		if (done) {
			this.done = true;
		}
		this.getinfo();
	}

	this.fetch = function(callback, limit) {
		if (this.expectedOrder.length) {
			console.log("fetch called while already in progress!", arguments);
			console.trace();
			return;
		}
		this.limit = limit;
		this.callback = callback;
		if (this.done || this.queue.length >= limit) {
			this.getinfo();
		} else {
			this.proxy.fetch(this.cb.bind(this), limit);
		}
	}
	this.abort = function() {
		this.proxy.abort();
		for (var k in this.pending) {
			if (this.pending.hasOwnProperty(k)) {
				ajax_abort(this.pending[k]);
			}
		}
		this.pending = {};
		this.expectedOrder.length = 0;
		this.unorderedResults = {};
		this.orderedResults.length = 0;
	}
	this.remove = function(key, prefix) {
		var lo = prefix ? plid_range_low(key) : key;
		var hi = prefix ? plid_range_high(key) : key;
		var wasActive = !!this.expectedOrder.length;
		var n1 = 0, n2 = 0, n3 = 0, n4 = 0, n5 = 0;
		for (var j = this.expectedOrder.length - 1; j >= 0; j--) {
			if (lo <= this.expectedOrder[j] && this.expectedOrder[j] <= hi) {
				this.expectedOrder.splice(j, 1);
				n1 += 1;
			}
		}
		for (var k in this.pending) {
			if (this.pending.hasOwnProperty(k) && lo <= k && k <= hi) {
				ajax_abort(this.pending[k]);
				delete this.pending[k];
				n2 += 1;
			}
		}
		for (var j = this.orderedResults.length - 1; j >= 0; j--) {
			if (lo <= this.orderedResults[j].key && this.orderedResults[j].key <= hi) {
				this.orderedResults.splice(j, 1);
				n3 += 1;
			}
		}
		for (var k in this.unorderedResults) {
			if (this.unorderedResults.hasOwnProperty(k) && lo <= k && k <= hi) {
				delete this.unorderedResults[k];
				n4 += 1;
			}
		}
		for (var j = this.queue.length - 1; j >= 0; j--) {
			if (lo <= this.queue[j].key && this.queue[j].key <= hi) {
				this.queue.splice(j, 1);
				n5 += 1;
			}
		}
		var isActive = !!this.expectedOrder.length;
		if (n1 + n2 + n3 + n4 + n5) {
			console.log("deleted from playlist iterator:", n1, n2, n3, n4, n5, "; active:", wasActive, "->", isActive);
		}
		if (wasActive) {
			this.orderResults();
		}
	}
}

function PlaylistView(playlist, plid, idx) {
	var viewPrefix = DB_URL + DB_NAME + "/_all_docs/";

	var reverseEndkey = playlist + ":";
	var startkey = plid ? plid : playlist + ":";
	var endkey = playlist + ":z";

	this.getForwardIterator = function() {
		var proxy = new ViewProxy(viewPrefix, startkey, endkey, false, true);
		return new PlaylistIterator(proxy, startkey, idx, false);
	}

	this.getReverseIterator = function() {
		var proxy = new ViewProxy(viewPrefix, startkey, reverseEndkey, true, true);
		return new PlaylistIterator(proxy, startkey, idx, true);
	}
}

function Remote() {
	var viewPrefix = DB_URL + DB_NAME + "/_design/file/_view/";
	var viewAll = DB_URL + DB_NAME + "/_all_docs/";

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
			return null;
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
			if (t !== null) {
				temp.push(t);
			}
		}
		var proxy;
		if (temp.length) {
			temp.sort();
			var ps = temp[temp.length - 1];
			proxy = new ViewProxy(viewPrefix + ps[1], ps[2], ps[2] + ps[3]);
		}
		if (!temp.length) {
			proxy = new ViewProxy(viewAll, null, null, false, true);
			temp.push([0, "all", null, null]);
		}
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
	var config = this.config;
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
	this.xhr = ajax_get(this.url + "&since=" + this.seq + this.getArguments(), this.onChange.bind(this), {timeout: 120000});
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
		ajax_abort(this.xhr);
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
