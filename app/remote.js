var DB_URL = '/';
var DB_PREFIX = ''; // %%%DB_PREFIX%%%

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
			} else {
				error(url, xhr);
			}
		}
	}
	xhr.send(null);
}

function get_file_info(name, callback) {
	function cb(data) {
		callback(JSON.parse(data));
	}
	ajax_get(DB_URL + DB_PREFIX + "file/" + encodeURIComponent(name), cb);
}

function ViewProxy(url, startkey, endkey) {
	this.url = url;
	this.startkey = startkey;
	this.endkey = endkey;
	this.currentstartkey = startkey;
	this.skip = 0;
	this._url = url + "?endkey=" + encodeURIComponent(JSON.stringify(this.endkey));

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
			var ids = new Array(rows.length);
			for (var i = 0; i < rows.length; i++) {
				var row = rows[i];
				if (row.key == currentkey) {
					skip += 1;
				} else {
					currentkey = row.key;
					skip = 1;
				}
				ids[i] = row.id;
			}
			me.skip = skip;
			me.currentstartkey = currentkey;
			if (!limit || ids.length < limit) {
				ids.push(null);
			}
			callback(ids);
		}

		ajax_get(url, cb);
	}
}

function ViewFilter(proxy, nextFilter) {
	this.proxy = proxy;
	this.nextFilter = nextFilter;
	this.ids = null;
	this.waiting = [];

	var me = this;

	function doFilter(ids, cb) {
		var filtered = [];
		var myids = me.ids;
		for (var i = 0; i < ids.length; i++) {
			if (myids.hasOwnProperty(ids[i]) || ids[i] === null) {
				filtered.push(ids[i]);
			}	
		}
		if (me.nextFilter) {
			me.nextFilter.filter(filtered, cb);
		} else {
			cb(filtered);
		}
	}

	proxy.fetch(function(ids) {
		me.ids = {};
		for (var i = 0; i < ids.length; i++) {
			if (ids[i] !== null) {
				me.ids[ids[i]] = true;
			}
		}
		var w = me.waiting;
		me.waiting = null;
		for (var i = 0; i < w.length; i++) {
			doFilter(w[i][0], w[i][1]);
		}
	})

	this.filter = function(ids, cb) {
		if (this.waiting !== null) {
			this.waiting.push([ids, cb]);
		} else {
			doFilter(ids, cb);
		}
	}
}

function ViewIterator(proxy, filter) {
	this.proxy = proxy;
	this.filter = filter;

	this.fetch = function(callback, limit) {
		var me = this;

		function cb(ids) {
			if (me.filter) {
				me.filter.filter(ids, callback);
			} else {
				callback(ids);
			}
		}
		this.proxy.fetch(cb, limit);
	}
}

function Remote() {
	var viewPrefix = "file/_design/db/_view/";

	function lc(v) {
		return v.toLowerCase();
	}
	function eq(v) {
		return v;
	}
	var prefixes = {
		"artist": {view: "artist", transform: lc, range: "ZZZZZ", mod: 3},
		"album": {view: "album", transform: lc, range: "ZZZZZ", mod: 2},
		"title": {view: "title", transform: lc, range: "ZZZZZ", mod: 1},
		"artist2": {view: "artist2", transform: eq, range: "", mod: 13},
		"album2": {view: "album2", transform: eq, range: "", mod: 12},
		"title2": {view: "title2", transform: eq, range: "", mod: 11},
		"all": {view: "search", transform: lc, range: "ZZZZZ", mod: 0},
		"*": {view: "search", transform: lc, range: "ZZZZZ", mod: 0}
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
		for (var i = 0; i < temp.length; i++) {
			temp[i] = new ViewProxy(DB_URL + DB_PREFIX + viewPrefix + temp[i][1], temp[i][2], temp[i][2] + temp[i][3]);
		}
		
		var filter = null;
		for (var i = 1; i < temp.length; i++) {
			filter = new ViewFilter(temp[i], filter);
		}
		return new ViewIterator(temp[0], filter);
	}
}

function Subscribe(db, readyCb, changesCb, config) {
	// http://localhost:5984/file/_changes?limit=1&since=60868&feed=longpoll
	var url = DB_URL + DB_PREFIX + db + "/_changes";
	var mode = "failed";
	var seq = null;
	var me = this;

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

	function ready(data) {
		var data = JSON.parse(data);
		seq = data.last_seq;
		mode = "pending";
		url += "?feed=longpoll";
		if (config.filter) {
			url += "&filter=" + config.filter;
		}
		if (config.timeout) {
			url += "&timeout=" + config.timeout;
		}
		if (config.heartbeat) {
			url += "&heartbeat=" + config.heartbeat;
		}
		if (config.limit) {
			url += "&limit=" + config.limit;
		}
		if (config.include_docs) {
			url += "&include_docs=" + config.include_docs;
		}
		if (readyCb(me) !== false) {
			me.start();
		}
	}

	function readyError(url, xhr) {
		console.log("readyError", mode, url, xhr);
		if (mode !== "preparing") {
			return;
		}
		mode = "cancelled";
		if (config.readyErrorCb && config.readyErrorCb(me, xhr) === true) {
			prepare();
		}
	}

	function changes(data) {
		if (mode !== "waiting") {
			return;
		}
		mode = "processing";
		var data = JSON.parse(data);
		seq = data.last_seq;
		if (changesCb(data.results) === false) {
			mode = "pending";
		} else {
			poll();
		}
	}

	function changesError(url, xhr) {
		console.log("changesError", mode, url, xhr);
		if (mode !== "waiting") {
			return;
		}
		mode = "pending";
		if (config.errorCb && config.errorCb(me, xhr) === true) {
			mode = "processing";
			poll();
		}
	}

	function poll() {
		if (mode !== "processing") {
			throw ["illegal state (poll)", mode];
		}
		mode = "waiting";
		ajax_get(url + "&since=" + seq, changes, changesError);
	}

	this.cancel = function() {
		if (mode === "preparing") {
			mode = "failed";
		} else if (mode === "processing" || mode === "waiting") {
			mode = "pending";
		}
	}

	this.start = function() {
		if (mode !== "pending") {
			throw ["illegal state (start)", mode];
		}
		mode = "processing";
		poll();
	}

	this.prepare = function() {
		if (mode !== "failed") {
			throw ["illegal state (prepare)", mode];
		}
		mode = "preparing";
		ajax_get(url + "?descending=true&limit=1", ready, readyError);
	}

	this.getMode = function() {
		return mode;
	}

	this.prepare();
}
