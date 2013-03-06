function (doc) {
	if (doc.type !== "playlist") {
		return;
	}
	var p = doc._id.length - 27;
	emit(doc._id.substring(0, p), null);
}
