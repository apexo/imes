function (doc) {
	if (doc.type !== "playlist") {
		return;
	}
	var p = doc._id.indexOf("/");
	emit(doc._id.substring(0, p), null);
}
