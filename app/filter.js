createFilter = (function() {
	function artist(term) {
		var start = term[0], end = term[1];
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
		var start = term[0], end = term[1];
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
		var start = term[0], end = term[1];
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
	function genre(term) {
		var start = term[0], end = term[1];
		return function(doc) {
			var a = doc.genre;
			if (a && a.length) {
				for (var i = 0; i < a.length; i++) {
					var value = a[i].toLocaleLowerCase().split(' ');
					for (var j = 0; j < value.length; j++) {
						if (value[j] && (start.localeCompare(value[j]) <= 0) && (value[j].localeCompare(end) <= 0)) {
							return true;
						}
					}
				}
			}
			return false;
		};
	}
	function path(term) {
		term = term[0];

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
		term = term[0];

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
		term = term[0];

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
		term = term[0];

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
	function genre2(term) {
		term = term[0];

		return function(doc) {
			var a = doc.genre;
			if (a && a.length) {
				for (var i = 0; i < a.length; i++) {
					if (a[i].trim() && a[i] === term) {
						return true;
					}
				}
			}
			return false;
		};
	}
	function path2(term) {
		term = term[0];

		return function(doc) {
			return doc.path === term;
		};
	}
	function mbid(term) {
		term = term[0];

		return function(doc) {
			var a = doc.musicbrainz_trackid;
			if (term === "-") {
				return !a || !a.length;
			} else {
				if (!a) {
					return false;
				}
				for (var i = 0; i < a.length; i++) {
					if (a[i] === term) {
						return true;
					}
				}
				return false;
			}
		}
	}
	function parseDateRange(range) {
		function formatDate(y, m, d) {
			while (y.length < 4) {
				y = "0" + y;
			}
			while (m.length < 2) {
				m = "0" + m;
			}
			while (d.length < 2) {
				d = "0" + d;
			}
			return y + "-" + m + "-d";
		}

		var	sep = range.indexOf("~"),
			start = sep === -1 ? range : range.substring(0, sep),
			end = sep === -1 ? "" : range.substring(sep + 1),
			re = /(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/,
			startDate = re.exec(start) || ["", "0000", undefined, undefined],
			endDate = re.exec(end) || ["", "9999", undefined, undefined];

		return [
			formatDate(startDate[1], startDate[2] || "00", startDate[3] || "00"),
			formatDate(endDate[1],endDate[2] || "12", endDate[3] || "31"),
		]
	}
	function expandDate(date) {
		if (date.length === 4) {
			return date + "-00-00";
		} else if (date.length === 7) {
			return date + "-00";
		} else {
			return date;
		}
	}
	function date(term) {
		var	start = term[0], end = term[1];

		return function(doc) {
			return doc.date && (start <= expandDate(doc.date)) && (expandDate(doc.date) <= end);
		}
	}
	function odate(term) {
		var	start = term[0], end = term[1];

		return function(doc) {
			return doc.originaldate && (start <= expandDate(doc.originaldate)) && (expandDate(doc.originaldate) <= end);
		}
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
		"genre": genre,
		"genre2": genre2,
		"path2": path2,
		"mbid": mbid,
		"date": date,
		"odate": odate,
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
