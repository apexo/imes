function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.title && doc.title.length) {
		for (var i = 0; i < doc.title.length; i++) {
			var value = doc.title[i].toLowerCase().split(' ');
			for (var j = 0; j < value.length; j++) {
				emit(value[j], null);
			}
		}
	}
}
