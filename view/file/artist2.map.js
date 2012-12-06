function (doc) {
	if (doc.artist && doc.artist.length) {
		for (var i = 0; i < doc.artist.length; i++) {
			if (doc.artist[i]) {
				emit(doc.artist[i], null);
			}
		}
	}
}
