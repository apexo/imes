function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.title && doc.title.length) {
		for (var i = 0; i < doc.title.length; i++) {
			if (doc.title[i]) {
				emit(doc.title[i], null);
			}
		}
	}
}
