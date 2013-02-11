function (doc) {
	if (doc.type !== "file") {
		return;
	}
	var p = doc.path.lastIndexOf("/");
	if (p >= 0 && doc.album) {
		var path = doc.path.substring(0, p);

                for (var i = 0; i < doc.album.length; i++) {
                        if (doc.album[i]) {
                                emit([path, doc.album[i], doc.discnumber || 0], null);
                        }
                }
	}
}
