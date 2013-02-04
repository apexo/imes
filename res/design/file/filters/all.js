function (doc, req) {
	if (doc._id.substring(0, 9) === "playlist:") {
		return req.query.playlist && doc._id.substring(9, 10 + req.query.playlist.length) === req.query.playlist + "/";
	}
	if (doc._id.substring(0, 8) === "channel:") {
		return req.query.channel && doc._id.substring(8) === req.query.channel;
	}
	return doc._deleted || doc.type === "file";
}
