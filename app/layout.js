function parsePadding(v) {
	if (!v) {
		return 0;
	}
	if (v.length < 3 || v.substring(v.length - 2) !== "px") {
		throw "illegal padding value: " + v;
	}
	return parseInt(v.substring(0, v.length - 2));
}

function IDGenerator() {
	this.n = 0;
	this.next = function() {
		this.n += 1;
		return "ii-" + this.n;
	}
}

function LayoutManager() {
	this.registry = {};
	this.layoutRoot = {};

	this.registerLayout = function(element, layout) {
		if (!element.id) {
			element.id = idGenerator.next();
		}
		this.registry[element.id] = layout;

		/* check whether any child is a layout root */
		while (true) {
			var lr = element.querySelectorAll('[data-layoutroot="1"]');
			if (!lr.length) {
				break;
			}
			for (var i = 0; i < lr.length; i++) {
				lr.removeAttribute("data-layoutroot");
				delete this.layoutRoot[lr.id];
				if (lr.parentElement !== element) {
					new AutoLayout(lr.parentElement);
				}
			}
		}
		
		/* check whether any parent has a layout, if so: insert AutoLayout() in between */
		var p = element.parentElement;
		if (p) {
			if (this.registry.hasOwnProperty(p.id)) {
				return;
			}
			while (p.parentElement) {
				p = p.parentElement;
				if (this.registry.hasOwnProperty(p.id)) {
					new AutoLayout(element.parentElement);
					return;
				}
			}
		}
		this.layoutRoot[element.id] = true;
		element.setAttribute("data-layoutroot", "1");
	}

	this.calculateLayout = function(element, width, height) {
		if (!this.registry.hasOwnProperty(element.id)) {
			if (!isNaN(width) && !isNaN(height)) {
				return {width: width, height: height};
			}
			var b = getSize(element);
			if (isNaN(width)) {
				width = b.width; // element.clientWidth;
			}
			if (isNaN(height)) {
				height = b.height; // element.clientHeight;
			}
			return {width: width, height: height};
		}
		return this.registry[element.id].calculateLayout(width, height);
	}

	this.applyLayout = function(element) {
		if (this.registry.hasOwnProperty(element.id)) {
			return this.registry[element.id].applyLayout();
		}
	}

	this.layout = function() {
		for (k in this.layoutRoot) {
			if (this.layoutRoot.hasOwnProperty(k)) {
				this.registry[k].calculateLayout(NaN, NaN);
			}
		}
		for (k in this.layoutRoot) {
			if (this.layoutRoot.hasOwnProperty(k)) {
				this.registry[k].applyLayout();
			}
		}
	}
}

var idGenerator = new IDGenerator();
var layoutManager = new LayoutManager();

function AutoLayout(element) {
	layoutManager.registerLayout(element, this);

	this.element = element;
	this.box = getBox(element);

	this.childBoxes = new Array();

	var children = element.children;
	for (var i = 0; i < children.length; i++) {
		this.childBoxes[i] = getBox(children[i]);
	}

	this.calculateLayout = function(width, height) {
		var iw = width - this.box.internal.leftRight;
		var ih = height - this.box.internal.topBottom;

		var childSizes = new Array();
		var mw = 0, mh = 0;

		var children = this.element.children;
		if (!children.length) {
			mw = isNaN(width) ? 0 : width;
			mh = isNaN(height) ? 0 : height;
		}
		for (var i = 0; i < children.length; i++) {
			childSizes[i] = layoutManager.calculateLayout(children[i], iw - this.childBoxes[i].external.leftRight, ih - this.childBoxes[i].external.topBottom);
			// console.log("auto", children[i], childSizes[0], this.childBoxes[i]);
			mw = Math.max(mw, childSizes[i].width + this.childBoxes[i].external.leftRight);
			mh = Math.max(mh, childSizes[i].height + this.childBoxes[i].external.topBottom);
		}

		this.childSizes = childSizes;

		return {
			width: mw + this.box.internal.leftRight,
			height: mh + this.box.internal.topBottom
		}
	}

	this.applyLayout = function() {
		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			var cs = this.childSizes[i];

			child.style.left = this.box.padding.left + this.childBoxes[i].margin.left;
			child.style.top = this.box.padding.top + this.childBoxes[i].margin.top;
			child.style.width = cs.width;
			child.style.height = cs.height;
			child.style.position = "absolute";

			layoutManager.applyLayout(child);
		}
	}
}

function ViewportLayout(element, childLayout) {
	this.childLayout = childLayout || new AutoLayout(element);

	layoutManager.registerLayout(element, this);

	this.element = element;
	this.box = getBox(element);

	this.calculateLayout = function(width, height) {
		var iw = window.innerWidth - this.box.external.leftRight;
		var ih = window.innerHeight - this.box.external.topBottom;

		self.w = iw;
		self.h = ih;

		//console.log("viewport", iw, ih);

		this.childLayout.calculateLayout(iw, ih);

		return {width: iw, height: ih};
	}

	this.applyLayout = function() {
		this.element.style.left = this.box.margin.left + "px";
		this.element.style.top = this.box.margin.top + "px";
		this.element.style.width = self.w + "px";
		this.element.style.height = self.h + "px";
		this.element.style.position = "absolute";
		this.childLayout.applyLayout();
	}
}

function parseBorder(p, n) {
	var px = CSSPrimitiveValue.CSS_PX;
	if (n == 1) {
		var v = p[0].getFloatValue(px);
		return {
			top: v,
			right: v,
			bottom: v,
			left: v,
			topBottom: v+v,
			leftRight: v+v
		};
	} else if (n == 2) {
		var v = p[0].getFloatValue(px);
		var w = p[1].getFloatValue(px);
		return {
			top: v,
			right: w,
			bottom: v,
			left: w,
			topBottom: v+v,
			leftRight: w+w,
		};
	} else if (n == 3) {
		var v = p[0].getFloatValue(px);
		var w = p[1].getFloatValue(px);
		var x = p[2].getFloatValue(px);
		return {
			top: v,
			right: w,
			bottom: x,
			left: w,
			topBottom: v+x,
			leftRight: w+w
		};
	} else {
		var v = p[0].getFloatValue(px);
		var w = p[1].getFloatValue(px);
		var x = p[2].getFloatValue(px);
		var y = p[3].getFloatValue(px);
		return {
			top: v,
			right: w,
			bottom: x,
			left: y,
			topBottom: v+x,
			leftRight: w+y
		}
	}
}

function computedPadding(element) {
	var p = window.getComputedStyle(element).getPropertyCSSValue("padding");
	return parseBorder(p, p.length);
}

function computedMargin(element) {
	var p = window.getComputedStyle(element).getPropertyCSSValue("margin");
	return parseBorder(p, p.length);
}

function computedBorder(element) {
	var p = window.getComputedStyle(element).getPropertyCSSValue("border-width");
	return parseBorder(p, p.length);
}

function _add(a, b) {
	return {
		top: a.top + b.top,
		bottom: a.bottom + b.bottom,
		left: a.left + b.left,
		right: a.right + b.right,
		topBottom: a.topBottom + b.topBottom,
		leftRight: a.leftRight + b.leftRight
	}
}

var noBorder = {
	top: 0,
	bottom: 0,
	left: 0,
	right: 0,
	topBottom: 0,
	leftRight: 0
}

function getBox(element) {
	var boxSizing = window.getComputedStyle(element).boxSizing;
	var padding = computedPadding(element);
	var border = computedBorder(element);
	var margin = computedMargin(element);

	var dw, dh, internal, external;

	if (boxSizing === "content-box") {
		dw = -padding.leftRight;
		dh = -padding.topBottom;
		internal = noBorder;
		external = _add(_add(padding, border), margin);
	} else if (boxSizing == "border-box") {
		dw = 0;
		dh = 0;
		internal = padding;
		external = _add(border, margin);
	} else {
		throw ["unsupported box-sizing", element, boxSizing];
	}
	return {
		boxSizing: boxSizing,
		element: element,
		internal: internal,
		external: external,
		margin: margin,
		padding: padding,
		border: border,
		getBorderBoxWidth: function(w) {
			return w - dw;
		},
		getBorderBoxHeight: function(h) {
			return h - dh;
		},
		getWidth: function() {
			return element.clientWidth + dw;
		},
		getHeight: function() {
			return element.clientHeight + dh;
		}
	}
}

function getSize(element) {
	var boxSizing = window.getComputedStyle(element).boxSizing;
	var bb = element.getBoundingClientRect();
	if (boxSizing === "content-box") {
		var padding = computedPadding(element);
		return {
			width: bb.width - padding.leftRight,
			height: bb.height - padding.topBottom
		};
	} else if (boxSizing === "border-box") {
		return {width: bb.width, height: bb.height};
	} else {
		throw ["unsupported box-sizing", element, boxSizing];
	}
}

function HBoxLayout(element) {
	layoutManager.registerLayout(element, this);

	this.element = element;
	this.totalWeight = 0;
	this.weights = new Array();
	this.childBoxes = new Array();
	this.totalExtra = 0;
	this.spacing = 4;

	var children = element.children;
	for (var i = 0; i < children.length; i++) {
		var w = children[i].attributes["data-weight"];
		if (w) {
			this.weights[i] = parseInt(w.value);
		} else {
			this.weights[i] = 0;
		}
		this.totalWeight += this.weights[i];
		this.childBoxes[i] = getBox(children[i]);
		this.totalExtra += this.childBoxes[i].external.leftRight;
	}

	this.totalExtra += this.spacing * (children.length - 1);
	this.box = getBox(element);
	this.padding = this.box.internal;

	if (element.style.width) {
		this.getWidth = this.box.getWidth;
	} else {
		this.getWidth = function(width) {
			return width;
		}
	}

	if (element.style.height) {
		this.getHeight = this.box.getHeight;
	} else {
		this.getHeight = function(height) {
			return height;
		}
	}

	this.calculateLayout = function(width, height) {
		var w = this.getWidth(width);
		var h = this.getHeight(height);
		var iw = w - this.box.internal.leftRight;
		var ih = h - this.box.internal.topBottom;

		var unmanagedWidth = this.totalExtra;
		var childSizes = new Array();

		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			if (!this.weights[i]) {
				var childSize = layoutManager.calculateLayout(children[i], NaN, ih - this.childBoxes[i].external.topBottom);
				unmanagedWidth += childSize.width;
				childSizes[i] = childSize;
			}
		}

		var managedWidth = iw - unmanagedWidth;
		var managedX = 0;
		var managedF = this.totalWeight ? managedWidth / this.totalWeight : 0;
		var weightSum = 0;
		var unmanagedX = this.box.padding.left;
		var maxHeight = 0;

		for (var i = 0; i < children.length; i++) {
			var childSize;

			if (this.weights[i]) {
				weightSum += this.weights[i];
				var nmx = Math.round(weightSum * managedF);
				childSize = layoutManager.calculateLayout(children[i], nmx - managedX, ih - this.childBoxes[i].external.topBottom);
				childSize.left = managedX + unmanagedX + this.childBoxes[i].margin.left;
				childSizes[i] = childSize;
				managedX = nmx;
			} else {
				childSize = childSizes[i];
				childSize.left = managedX + unmanagedX + this.childBoxes[i].margin.left;
				unmanagedX += childSize.width;
			}
			unmanagedX += this.childBoxes[i].external.leftRight + this.spacing;
			maxHeight = Math.max(maxHeight, childSize.height + this.childBoxes[i].external.topBottom);
		}
		unmanagedX -= this.spacing;
		
		this.childSizes = childSizes;
		this.maxHeight = maxHeight;

		return {
			width: managedX + unmanagedX - this.box.padding.left + this.box.internal.leftRight,
			height: maxHeight + this.box.internal.topBottom
		}
	}

	this.applyLayout = function() {
		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			var cs = this.childSizes[i];
			var cb = this.childBoxes[i];
			
			child.style.left = cs.left;
			child.style.top = Math.floor((this.maxHeight - cs.height - cb.external.topBottom) / 2) + this.box.padding.top + cb.margin.top;
			if (this.weights[i]) {
				child.style.width = cs.width;
			}
			child.style.height = cs.height;
			child.style.position = "absolute";

			layoutManager.applyLayout(child);
		}
	}
}

function VBoxLayout(element) {
	layoutManager.registerLayout(element, this);

	this.element = element;
	this.totalWeight = 0;
	this.totalExtra = 0;
	this.weights = new Array();
	this.childBoxes = new Array();
	this.spacing = 0;

	var children = element.children;
	for (var i = 0; i < children.length; i++) {
		var w = children[i].attributes["data-weight"];
		if (w) {
			this.weights[i] = parseInt(w.value);
		} else {
			this.weights[i] = 0;
		}
		this.totalWeight += this.weights[i];
		this.childBoxes[i] = getBox(children[i]);
		this.totalExtra += this.childBoxes[i].external.topBottom;
	}

	this.totalExtra += this.spacing * (children.length - 1);
	this.box = getBox(element);
	this.padding = this.box.internal;

	if (element.style.width) {
		this.getWidth = this.box.getWidth;
	} else {
		this.getWidth = function(width) {
			return width;
		}
	}

	if (element.style.height) {
		this.getHeight = this.box.getHeight;
	} else {
		this.getHeight = function(height) {
			return height;
		}
	}

	this.calculateLayout = function(width, height) {
		var w = this.getWidth(width);
		var h = this.getHeight(height);
		var iw = w - this.padding.leftRight;
		var ih = h - this.padding.topBottom;

		var unmanagedHeight = this.totalExtra;
		var childSizes = new Array();

		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			if (!this.weights[i]) {
				var childSize = layoutManager.calculateLayout(children[i], iw - this.childBoxes[i].external.leftRight, NaN);
				unmanagedHeight += childSize.height;
				childSizes[i] = childSize;
			}
		}

		var managedHeight = ih - unmanagedHeight;
		var managedY = 0;
		var managedF = this.totalWeight ? managedHeight / this.totalWeight : 0;
		var weightSum = 0;
		var unmanagedY = this.box.padding.top;
		var maxWidth = 0;

		for (var i = 0; i < children.length; i++) {
			var childSize;

			if (this.weights[i]) {
				weightSum += this.weights[i];
				var nmy = Math.round(weightSum * managedF);
				childSize = layoutManager.calculateLayout(children[i], iw - this.childBoxes[i].external.leftRight, nmy - managedY);
				childSize.top = managedY + unmanagedY + this.childBoxes[i].margin.top;
				childSizes[i] = childSize;
				managedY = nmy;
			} else {
				childSize = childSizes[i];
				childSize.top = managedY + unmanagedY + this.childBoxes[i].margin.top;
				unmanagedY += childSize.height;
			}
			unmanagedY += this.childBoxes[i].external.topBottom + this.spacing;
			maxWidth = Math.max(maxWidth, childSize.width + this.childBoxes[i].external.leftRight);
		}
		unmanagedY -= this.spacing;
		
		this.childSizes = childSizes;
		this.maxWidth = maxWidth;

		return {
			width: maxWidth + this.padding.leftRight,
			height: managedY + unmanagedY - this.box.padding.top + this.box.internal.topBottom
		}
	}

	this.applyLayout = function() {
		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			var cs = this.childSizes[i];
			var cb = this.childBoxes[i];
			
			child.style.left = Math.floor((this.maxWidth - cs.width - cb.external.leftRight) / 2) + this.box.padding.left + cb.margin.left;
			child.style.top = cs.top;
			child.style.width = cs.width;
			if (this.weights[i]) {
				child.style.height = cs.height;
			}
			child.style.position = "absolute";

			layoutManager.applyLayout(child);
		}
	}
}

/*
function prepareLayout() {
	var p = {};
	var filter = document.querySelector("#top .filter");
	p.filter_width = filter.clientWidth;
	p.filter_label_width = filter.querySelector("label").getBoundingClientRect().width;
	p.controls_width = filter.querySelector("#controls").getBoundingClientRect().width;
	return p;
}

function doLayout(p){
	var filter = document.querySelector("#top .filter");
	console.log(p);
	filter.querySelector(".search").style.width = p.filter_width - p.filter_label_width - p.controls_width;
	console.log("ok");
}

function layout() {
	doLayout(prepareLayout());
}
*/
