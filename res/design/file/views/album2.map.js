function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.album && doc.album.length) {
		for (var i = 0; i < doc.album.length; i++) {
			if (doc.album[i]) {
				emit(doc.album[i], null);
			}
		}
	}
}
