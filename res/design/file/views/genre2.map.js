function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.genre && doc.genre.length) {
		for (var i = 0; i < doc.genre.length; i++) {
			if (doc.genre[i].trim()) {
				emit(doc.genre[i], null);
			}
		}
	}
}
