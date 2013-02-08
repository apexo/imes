function Navigation(target, layoutManager) {
	this.layoutManager = layoutManager;
	this.navTargets = {}
	this.navLinks = Array.prototype.slice.call(target.querySelectorAll("a[href]"));
	this.onnavigate = new Event();

	for (var i = 0; i < this.navLinks.length; i++) {
		var navLink = this.navLinks[i];
		if (navLink.dataset.targets) {
			var targets = navLink.dataset.targets.split(",");
			for (var j = 0; j < targets.length; j++) {
				this.navTargets[targets[j]] = true;
			}
		}
		navLink.addEventListener("click", this.clickHandler.bind(this), false);
	}
}

Navigation.prototype.clickHandler = function(event) {
	event.stopPropagation();
	event.preventDefault();
	this.triggerNavigation(event.target);
}

Navigation.prototype.triggerNavigation = function(target) {
	var targets = target.dataset.targets.split(",");
	for (var k in this.navTargets) {
		if (this.navTargets.hasOwnProperty(k)) {
			if (targets.indexOf(k) >= 0) {
				document.getElementById(k).style.display = "";
			} else {
				document.getElementById(k).style.display = "none";
			}
		}
	}
	for (var i = 0; i < this.navLinks.length; i++) {
		var navLink = this.navLinks[i];
		if (navLink === target) {
			navLink.classList.add("active");
		} else {
			navLink.classList.remove("active");
		}
	}
	this.layoutManager.layout();
	this.onnavigate.fire(this, target);
}
