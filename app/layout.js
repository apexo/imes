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
		if (element.style.display === "none") {
			return;
		}
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

			child.style.left = (this.box.padding.left + this.childBoxes[i].margin.left) + "px";
			child.style.top = (this.box.padding.top + this.childBoxes[i].margin.top) + "px";
			child.style.width = cs.width + "px";
			child.style.height = cs.height + "px";
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

function _getPixelValue(value) {
	if (!value) {
		return 0;
	} else if (value.substring(value.length - 2) === "px") {
		return parseFloat(value.substring(0, value.length - 2));
	} else {
		return 0;
	}
}

function computedPadding(element) {
	var	s = window.getComputedStyle(element),
		top = _getPixelValue(s.paddingTop),
		right = _getPixelValue(s.paddingRight),
		bottom = _getPixelValue(s.paddingBottom),
		left = _getPixelValue(s.paddingLeft);
	return {top: top, right: right, bottom: bottom, left: left, topBottom: top+bottom, leftRight: left+right};
}

function computedMargin(element) {
	var	s = window.getComputedStyle(element),
		top = _getPixelValue(s.marginTop),
		right = _getPixelValue(s.marginRight),
		bottom = _getPixelValue(s.marginBottom),
		left = _getPixelValue(s.marginLeft);
	return {top: top, right: right, bottom: bottom, left: left, topBottom: top+bottom, leftRight: left+right};
}

function computedBorder(element) {
	var	s = window.getComputedStyle(element),
		top = _getPixelValue(s.borderTopWidth),
		right = _getPixelValue(s.borderRightWidth),
		bottom = _getPixelValue(s.borderBottomWidth),
		left = _getPixelValue(s.borderLeftWidth);
	return {top: top, right: right, bottom: bottom, left: left, topBottom: top+bottom, leftRight: left+right};
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

	if (!boxSizing || boxSizing === "content-box") {
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
	if (!boxSizing || boxSizing === "content-box") {
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
				if (childSize) {
					unmanagedWidth += childSize.width;
					childSizes[i] = childSize;
				}
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
				if (childSize) {
					childSize.left = managedX + unmanagedX + this.childBoxes[i].margin.left;
					childSize.setWidth = true;
					childSizes[i] = childSize;
				}
				managedX = nmx;
			} else {
				childSize = childSizes[i];
				if (childSize) {
					childSize.left = managedX + unmanagedX + this.childBoxes[i].margin.left;
					unmanagedX += childSize.width;
				}
			}
			unmanagedX += this.childBoxes[i].external.leftRight + this.spacing;
			if (childSize) {
				maxHeight = Math.max(maxHeight, childSize.height + this.childBoxes[i].external.topBottom);
			}
		}
		unmanagedX -= this.spacing;
		
		this.childSizes = childSizes;
		this.maxHeight = maxHeight;

		return {
			width: managedX + unmanagedX - this.box.padding.left + this.box.internal.leftRight,
			height: maxHeight + this.box.internal.topBottom,
			setHeight: true,
			setWidth: true
		}
	}

	this.applyLayout = function() {
		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			var cs = this.childSizes[i];
			if (!cs) {
				continue;
			}
			var child = children[i];
			var cb = this.childBoxes[i];
			
			child.style.left = cs.left + "px";
			child.style.top = (Math.floor((this.maxHeight - cs.height - cb.external.topBottom) / 2) + this.box.padding.top + cb.margin.top) + "px";
			if (cs.setWidth || this.weights[i]) {
				child.style.width = cs.width + "px";
			}
			if (cs.setHeight) {
				child.style.height = cs.height + "px";
			}
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
				if (childSize) {
					unmanagedHeight += childSize.height;
					childSizes[i] = childSize;
				}
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
				if (childSize) {
					childSize.top = managedY + unmanagedY + this.childBoxes[i].margin.top;
					childSize.setHeight = true;
					childSizes[i] = childSize;
				}
				managedY = nmy;
			} else {
				childSize = childSizes[i];
				if (childSize) {
					childSize.top = managedY + unmanagedY + this.childBoxes[i].margin.top;
					unmanagedY += childSize.height;
				}
			}
			unmanagedY += this.childBoxes[i].external.topBottom + this.spacing;
			if (childSize) {
				maxWidth = Math.max(maxWidth, childSize.width + this.childBoxes[i].external.leftRight);
			}
		}
		unmanagedY -= this.spacing;
		
		this.childSizes = childSizes;
		this.maxWidth = maxWidth;

		return {
			width: maxWidth + this.padding.leftRight,
			height: managedY + unmanagedY - this.box.padding.top + this.box.internal.topBottom,
			setHeight: true,
			setWidth: true
		}
	}

	this.applyLayout = function() {
		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			var cs = this.childSizes[i];
			if (!cs) {
				continue;
			}
			var child = children[i];
			var cb = this.childBoxes[i];
			
			child.style.left = (Math.floor((this.maxWidth - cs.width - cb.external.leftRight) / 2) + this.box.padding.left + cb.margin.left) + "px";
			child.style.top = cs.top + "px";
			if (cs.setWidth) {
				child.style.width = cs.width + "px";
			}
			if (cs.setHeight || this.weights[i]) {
				child.style.height = cs.height + "px";
			}
			child.style.position = "absolute";

			layoutManager.applyLayout(child);
		}
	}
}

function HeaderLayout(element) {
	layoutManager.registerLayout(element, this);

	this.element = element;
	this.childBoxes = new Array();

	var children = element.children;
	for (var i = 0; i < children.length; i++) {
		this.childBoxes[i] = getBox(children[i]);
	}

	this.box = getBox(element);

	this.calculateLayout = function(width, height) {
		var iw = window.innerWidth - this.box.external.leftRight - this.box.internal.leftRight;
		var ih = 0;
		var childSizes = new Array();

		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			childSizes[i] = layoutManager.calculateLayout(children[i], iw - this.childBoxes[i].external.leftRight, NaN);
			if (childSizes[i]) {
				ih += childSizes[i].height;
			}
		}

		this.childSizes = childSizes;

		return {
			width: iw + this.box.internal.leftRight,
			height: ih + this.box.internal.topBottom
		}
	}

	this.applyLayout = function() {
		var children = this.element.children;
		for (var i = 0; i < children.length; i++) {
			var cs = this.childSizes[i];
			if (!cs) {
				continue;
			}
			var child = children[i];
			var cb = this.childBoxes[i];

			if (i === 0) {
				this.element.style.marginTop = (cs.height + cb.external.topBottom) + "px";
				child.style.position = "fixed";
				child.style.left = (this.box.padding.left + cb.margin.left) + "px";
				child.style.top = (this.box.padding.top + cb.margin.top) + "px";
				child.style.width = cs.width + "px";
				child.style.height = cs.height + "px";
			}

			layoutManager.applyLayout(child);
		}
	}
}
