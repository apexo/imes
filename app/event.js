function Event() {
	this.listeners = {};
}

Event.prototype.addListener = function(fn, scope, filter) {
	if (!fn.id) {
		fn.id = idGenerator.next();
	}
	this.listeners[fn.id] = {fn: fn, scope: scope, filter: filter || function() {return true;}};
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

function EventManager() {
	this.listeners = [];
}

EventManager.prototype.addListener = function(event, fn, scope, filter) {
	this.listeners.push({event: event, fn: fn});
	event.addListener(fn, scope, filter);
}

EventManager.prototype.destroy = function() {
	for (var i = 0; i < this.listeners.length; i++) {
		var l = this.listeners[i];
		l.event.removeListener(l.fn);
	}
	this.listeners.length = 0;
}
