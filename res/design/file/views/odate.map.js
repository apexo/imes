function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.originaldate) {
		if (doc.originaldate.length === 4) {
			suffix = "-00-00";
		} else if (doc.originaldate.length === 7) {
			suffix = "-00";
		} else {
			suffix = "";
		}
		emit(doc.originaldate + suffix, null);
	}
}
