var RAF = new (function() {
	var n = 0;
	var running = false;
	this.map = {};

	this.run = function() {
		for (k in this.map) {
			if (this.map.hasOwnProperty(k)) {
				this.map[k]();
			}
		}

		if (n) {
			this.start();
		} else {
			running = false;
		}

	}

	this.start = function() {
		running = true;
		if (window.requestAnimationFrame) {
			window.requestAnimationFrame(this.run.bind(this));
		} else {
			setTimeout(this.run.bind(this), 1000);
		}
	}

	this.register = function(name, func) {
		if (!this.map.hasOwnProperty(name)) {
			n++;
		}
		this.map[name] = func;
		if (!running) {
			this.start();
		}
	}
	this.unregister = function(name) {
		if (this.map.hasOwnProperty(name)) {
			delete this.map[name];
			n -= 1;
		}
	}
	this.status = function() {
		return {n: n, running: running}
	}
})();
