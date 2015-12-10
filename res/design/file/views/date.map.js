function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.date) {
		if (doc.date.length === 4) {
			suffix = "-00-00";
		} else if (doc.date.length === 7) {
			suffix = "-00";
		} else {
			suffix = "";
		}
		emit(doc.date + suffix, null);
	}
}
