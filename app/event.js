function Event() {
	this.listeners = {};
}

Event.prototype.addListener = function(fn, scope) {
	if (!fn.id) {
		fn.id = idGenerator.next();
	}
	this.listeners[fn.id] = {fn: fn, scope: scope};
}

Event.prototype.removeListener = function(fn) {
	delete this.listeners[fn.id];
}

Event.prototype.fire = function(scope) {
	for (var id in this.listeners) {
		if (this.listeners.hasOwnProperty(id)) {
			var c = this.listeners[id];
			c.fn.apply(c.scope || scope, Array.prototype.slice.call(arguments, 1));
		}
	}
}
