var DB_URL = 'http://localhost:5984/'; // %%%DB_URL%%%
var DB_PREFIX = ''; // %%%DB_PREFIX%%%

function ajax_get(url, cb) {
	var xhr = new XMLHttpRequest();
	xhr.open("GET", url, true);
	xhr.onreadystatechange = function() {
		if (xhr.readyState === 4) {
			if (xhr.status === 200) {
				cb(xhr.responseText);
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

	function normalizeTerm(term) {
		var kv = term.split(":", 2)
		var k = kv.length === 1 || kv[0] === "*" ? "all" : kv[0];
		var v = kv[kv.length - 1];
		if (!v.length) {
			return [-1, "search", ""];
		}

		k = k.toLowerCase();
		v = decodeURI(v);
		if (k === "artist") {
			return [v.length + 3, "artist", v, "ZZZZZ"];
		} else if (k === "album") {
			return [v.length + 2, "album", v, "ZZZZZ"];
		} else if (k === "title") {
			return [v.length + 1, "title", v, "ZZZZZ"];
		} else if (k === "artist2") {
			return [v.length + 13, "artist2", v, ""];
		} else if (k === "album2") {
			return [v.length + 12, "album2", v, ""];
		} else if (k === "title2") {
			return [v.length + 11, "title2", v, ""];
		} else {
			return [v.length + 0, "search", v, "ZZZZZ"];
		}
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
