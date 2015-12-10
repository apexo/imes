function (doc) {
	if (doc.type !== "file") {
		return;
	}
	if (doc.musicbrainz_trackid && doc.musicbrainz_trackid.length) {
		for (var i = 0; i < doc.musicbrainz_trackid.length; i++) {
			emit(doc.musicbrainz_trackid[i], null);
		}
	} else {
		emit("-", null);
	}
}
