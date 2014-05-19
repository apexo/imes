createFilter = (function() {
	function artist(term) {
		var start = term.toLocaleLowerCase(), end = start + COUCH_SUFFIX;
		return function(doc) {
			var a = doc.artist;
			if (a && a.length) {
				for (var i = 0; i < a.length; i++) {
					var value = a[i].toLocaleLowerCase().split(' ');
					for (var j = 0; j < value.length; j++) {
						if ((start.localeCompare(value[j]) <= 0) && (value[j].localeCompare(end) <= 0)) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	function album(term) {
		var start = term.toLocaleLowerCase(), end = start + COUCH_SUFFIX;
		return function(doc) {
			var a = doc.album;
			if (a && a.length) {
				for (var i = 0; i < a.length; i++) {
					var value = a[i].toLocaleLowerCase().split(' ');
					for (var j = 0; j < value.length; j++) {
						if ((start.localeCompare(value[j]) <= 0) && (value[j].localeCompare(end) <= 0)) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	function title(term) {
		var start = term.toLocaleLowerCase(), end = start + COUCH_SUFFIX;
		return function(doc) {
			var a = doc.title;
			if (a && a.length) {
				for (var i = 0; i < a.length; i++) {
					var value = a[i].toLocaleLowerCase().split(' ');
					for (var j = 0; j < value.length; j++) {
						if ((start.localeCompare(value[j]) <= 0) && (value[j].localeCompare(end) <= 0)) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	function path(term) {
		return function(doc) {
			var a = doc.path;
			return a.substring(0, term.length) === term;
		};
	}
	function search(term) {
		var a = artist(term), b = title(term), c = album(term);
		return function(doc) {
			var result = a(doc) || b(doc) || c(doc);
			return result;
		};
	}
	function artist2(term) {
		return function(doc) {
			var a = doc.artist;
			if (a && a.length) {
				for (var i = 0; i < a.length; i++) {
					if (a[i] === term) {
						return true;
					}
				}
			}
			return false;
		};
	}
	function album2(term) {
		return function(doc) {
			var a = doc.album;
			if (a && a.length) {
				for (var i = 0; i < a.length; i++) {
					if (a[i] === term) {
						return true;
					}
				}
			}
			return false;
		};
	}
	function title2(term) {
		return function(doc) {
			var a = doc.title;
			if (a && a.length) {
				for (var i = 0; i < a.length; i++) {
					if (a[i] === term) {
						return true;
					}
				}
			}
			return false;
		};
	}
	function path2(term) {
		return function(doc) {
			return doc.path === term;
		};
	}
	function all(term) {
		return function(doc) {
			return true;
		}
	}
	var map = {
		"artist": artist,
		"album": album,
		"title": title,
		"search": search,
		"path": path,
		"artist2": artist2,
		"album2": album2,
		"title2": title2,
		"path2": path2,
		"all": all,
	}

	function createFilter(spec) {
		if (!spec || !spec.length) {
			return function(row) {return true;}
		}
		var filters = [];
		for (var i = 0; i < spec.length; i++) {
			var s = spec[i];
			filters[i] = map[s[0]](s[1]);
		}
		if (filters.length === 1) {
			var f = filters[0];
			return function(row) {
				return f(row.doc);
			};
		}
		var flen = filters.length;
		return function(row) {
			var doc = row.doc;
			for (var i = 0; i < flen; i++) {
				if (!filters[i](doc)) {
					return false;
				}
			}
			return true;
		}
	};
	return createFilter;
})();
