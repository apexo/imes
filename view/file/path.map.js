function (doc) {
	var path = doc._id;
	var p = path.lastIndexOf("/");
	while (p > 0) {
		path = path.substring(0, p);
		emit(path, null);
		p = path.lastIndexOf("/");
	}
}
