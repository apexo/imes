function (key, values, rereduce) {
	if (rereduce) {
		return sum(values);
	}
	return values.length;
}
