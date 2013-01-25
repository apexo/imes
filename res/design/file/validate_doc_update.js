function (newDoc, oldDoc, userCtx, secObj) {
	var isAdmin = userCtx.roles.indexOf("_admin") >= 0;
	var type = newDoc._deleted ? oldDoc.type : newDoc.type;
	if (newDoc._id.charAt(0) === "_" || newDoc._id === "app") {
		if (!isAdmin) {
			throw({forbidden: 'Only admin can change special documents.'});
		}
		return;
	}
	if (!type) {
		throw({forbidden: 'Document must have type.'});
	}
	if (type === "file" || type === "picture" || type === "imes:state" || type === "imes:channel") {
		if (!isAdmin) {
			throw({forbidden: 'Only admin can change database.'});
		}
	} else if (type === "playlist") {
		if (newDoc._id.substring(0, 9) !== "playlist:") {
			throw({forbidden: 'Invalid ID.'});
		}
	} else {
		throw({forbidden: 'Unsupported type.'});
	}
}
