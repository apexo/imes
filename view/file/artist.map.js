function (doc) {
	if (doc.artist && doc.artist.length) {
		for (var i = 0; i < doc.artist.length; i++) {
			var value = doc.artist[i].toLowerCase().split(' ');
			for (var j = 0; j < value.length; j++) {
				emit(value[j], null);
			}
		}
	}
}
