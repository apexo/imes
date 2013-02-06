function RequestAnimationFrame() {
	this.n = 0;
	this.running = false;
	this.map = {};
}

RequestAnimationFrame.prototype.run = function() {
	for (var k in this.map) {
		if (this.map.hasOwnProperty(k)) {
			this.map[k]();
		}
	}

	if (this.n) {
		this.start();
	} else {
		this.running = false;
	}
}

RequestAnimationFrame.prototype.start = function() {
	this.running = true;

	if (window.requestAnimationFrame) {
		window.requestAnimationFrame(this.run.bind(this));
	} else {
		setTimeout(this.run.bind(this), 1000);
	}
}

RequestAnimationFrame.prototype.register = function(name, func) {
	if (!this.map.hasOwnProperty(name)) {
		this.n++;
	}
	this.map[name] = func;
	if (!this.running) {
		this.start();
	}
}

RequestAnimationFrame.prototype.unregister = function(name) {
	if (this.map.hasOwnProperty(name)) {
		delete this.map[name];
		this.n --;
	}
}

var RAF = new RequestAnimationFrame();
