function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.album && doc.album.length) {
		for (var i = 0; i < doc.album.length; i++) {
			var value = doc.album[i].toLowerCase().split(' ');
			for (var j = 0; j < value.length; j++) {
				emit(value[j], null);
			}
		}
	}
}
