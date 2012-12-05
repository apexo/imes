function (doc) {
	var dup = {};

	if (doc.artist && doc.artist.length) {
		for (var i = 0; i < doc.artist.length; i++) {
			var value = doc.artist[i].toLowerCase().split(' ');
			for (var j = 0; j < value.length; j++) {
				if (!dup.hasOwnProperty(value[j])) {
					emit(value[j], null);
					dup[value[j]] = true;
				}
			}
		}
	}
	if (doc.album && doc.album.length) {
		for (var i = 0; i < doc.album.length; i++) {
			var value = doc.album[i].toLowerCase().split(' ');
			for (var j = 0; j < value.length; j++) {
				if (!dup.hasOwnProperty(value[j])) {
					emit(value[j], null);
					dup[value[j]] = true;
				}
			}
		}
	}
	if (doc.title && doc.title.length) {
		for (var i = 0; i < doc.title.length; i++) {
			var value = doc.title[i].toLowerCase().split(' ');
			for (var j = 0; j < value.length; j++) {
				if (!dup.hasOwnProperty(value[j])) {
					emit(value[j], null);
					dup[value[j]] = true;
				}
			}
		}
	}
}
