function (doc) {
	if (doc.type !== "file") {
		return;
	}
	var path = doc.path;
	var p = path.lastIndexOf("/");
	while (p > 0) {
		path = path.substring(0, p);
		emit(path, null);
		p = path.lastIndexOf("/");
	}
}
