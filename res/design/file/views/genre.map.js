function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.genre && doc.genre.length) {
		for (var i = 0; i < doc.genre.length; i++) {
			var value = doc.genre[i].toLowerCase().split(' ');
			for (var j = 0; j < value.length; j++) {
				if (value[j]) {
					emit(value[j], null);
				}
			}
		}
	}
}
