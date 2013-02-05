function avltree(left, right, key, value) {
	/*
	if (left !== undefined && (typeof left !== "object" || left.constructor !== avltree)) {
		throw "left should be a avltree or undefined";
	}
	if (right !== undefined && (typeof right !== "object" || right.constructor !== avltree)) {
		throw "right should be a avltree or undefined";
	}
	if (left !== undefined && key !== undefined && left.max().key >= key) {
		throw "left.max().key must be < key";
	}
	if (right !== undefined && key !== undefined && right.min().key <= key) {
		throw "right.min().key must be > key: " + right.min().key + " / " + key;
	}
	if (left !== undefined && !left.count) {
		throw "left.count must be > 0";
	}
	if (right !== undefined && !right.count) {
		throw "right.count must be > 0";
	}
	*/
	var lc = left ? left.count : 0;
	var rc = right ? right.count : 0;
	var ld = left ? left.depth : 0;
	var rd = right ? right.depth : 0;
	this.count = lc + rc;
	this.depth = Math.max(ld, rd);
	if (key !== undefined) {
		this.depth += 1;
		this.count += 1;
	}
	this.key = key;
	this.value = value;
	this.left = left;
	this.right = right;
	/* if (Math.abs(this.balance()) > 1) {
		console.trace();
		throw "invalid AVL tree";
	} */
}

avltree.prototype.max = function() {
	if (this.right) {
		return this.right.max();
	}
	if (this.key !== undefined) {
		return this;
	}
	if (this.left) {
		return this.left.max();
	}
}

avltree.prototype.min = function() {
	if (this.left) {
		return this.left.min();
	}
	if (this.key !== undefined) {
		return this;
	}
	if (this.right) {
		return this.right.min();
	}
}

avltree.prototype.lookupGte = function(key) {
	if (this.key === undefined) {
		return;
	}
	if (key > this.key) {
		return this.right ? this.right.lookupGte(key) : undefined;
	}
	var result = this.left ? this.left.lookupGte(key) : undefined;
	return result === undefined ? this : result;
}

avltree.prototype.getRange = function(lo, hi, result) {
	if (this.key === undefined) {
		return;
	}
	if (this.left && lo < this.key) {
		this.left.getRange(lo, hi, result);
	}
	if (lo <= this.key && this.key <= hi) {
		result.push(this.value);
	}
	if (this.right && hi > this.key) {
		this.right.getRange(lo, hi, result);
	}
}

avltree.prototype.balance = function() {
	return (this.left ? this.left.depth : 0) - (this.right ? this.right.depth : 0);
}

avltree.prototype.rotateRight = function() {
	return new avltree(this.left.left, new avltree(this.left.right, this.right, this.key, this.value), this.left.key, this.left.value);
}

avltree.prototype.rotateLeft = function() {
	return new avltree(new avltree(this.left, this.right.left, this.key, this.value), this.right.right, this.right.key, this.right.value);
}

avltree.prototype.balanceInternal = function(left, right) {
	return (left ? left.depth : 0) - (right ? right.depth : 0);
}

avltree.prototype.rotateRightInternal = function(left, right, key, value) {
	return new avltree(left.left, new avltree(left.right, right, key, value), left.key, left.value);
}

avltree.prototype.rotateLeftInternal = function(left, right, key, value) {
	return new avltree(new avltree(left, right.left, key, value), right.right, right.key, right.value);
}

avltree.prototype.insert = function(key, value) {
	if (this.key === undefined || this.key === key) {
		return new avltree(this.left, this.right, key, value);
	}
	var left, right;
	if (key > this.key) {
		if (!this.right) {
			return new avltree(this.left, new avltree(undefined, undefined, key, value), this.key, this.value);
		}
		left = this.left;
		right = this.right.insert(key, value);
	} else {
		if (!this.left) {
			return new avltree(new avltree(undefined, undefined, key, value), this.right, this.key, this.value);
		}
		left = this.left.insert(key, value);
		right = this.right;
	}

	var bal = this.balanceInternal(left, right);

	if (bal < -2 || bal > 2) {
		throw "invalid balance: " + bal;
	}

	if (bal >= -1 && bal <= 1) {
		return new avltree(left, right, this.key, this.value);
	}

	if (bal === -2) {
		if (right.balance() === 1) {
			right = right.rotateRight();
		}
		return this.rotateLeftInternal(left, right, this.key, this.value);
	} else { // bal === 2
		if (left.balance() === -1) {
			left = left.rotateLeft();
		}
		return this.rotateRightInternal(left, right, this.key, this.value);
	}
}

avltree.prototype.remove = function(key) {
	if (this.key === undefined) {
		return this;
	}
	var left, right, value;
	if (this.key === key) {
		if (this.left && (!this.right || this.left.depth >= this.right.depth)) {
			var rm = this.left.max()
			left = this.left.remove(rm.key);
			left = left.count ? left : undefined;
			right = this.right;
			key = rm.key;
			value = rm.value;
		} else if (this.right) {
			var rm = this.right.min()
			left = this.left;
			right = this.right.remove(rm.key);
			right = right.count ? right : undefined;
			key = rm.key;
			value = rm.value;
		} else {
			return new avltree(undefined, undefined, undefined, undefined);
		}
	} else if (key < this.key) {
		left = this.left ? this.left.remove(key) : this.left;
		if (left === this.left) {
			return this;
		}
		left = left.count ? left : undefined;
		right = this.right;
		key = this.key;
		value = this.value;
	} else {
		// key > this.key
		right = this.right ? this.right.remove(key) : this.right;
		if (right === this.right) {
			return this;
		}
		right = right.count ? right : undefined;
		left = this.left;
		key = this.key;
		value = this.value;
	}

	var bal = this.balanceInternal(left, right);
	
	if (bal === 2){
		if (left.balance() === -1) {
			left = left.rotateLeft();
		}
		return this.rotateRightInternal(left, right, key, value);
	} else if (bal === -2) {
		if (right.balance() === 1) {
			right = right.rotateRight();
		}
		return this.rotateLeftInternal(left, right, key, value);
	}
	return new avltree(left, right, key, value);
}

function avltree_benchmark() {
	var start, d = new avltree(), n = 1000000;
	start = Date.now();
	for (var i = 0; i < n; i++) {
		d = d.insert(i * 2, i + 7);
	}
	console.log("insert", Date.now() - start, d.count, d.depth, d);

	start = Date.now();
	for (var i = 0; i < n; i++) {
		d = d.insert(i * 2, i + 7);
	}
	console.log("insert again", Date.now() - start, d.count, d.depth, d);

	start = Date.now();
	for (var i = 0; i < n; i++) {
		d.lookupGte(i * 2 + 1);
	}
	console.log("lookup n/e", Date.now() - start);

	start = Date.now();
	for (var i = 0; i < n; i++) {
		d.lookupGte(i * 2);
	}
	console.log("lookup all", Date.now() - start);

	var d2 = d;

	start = Date.now();
	for (var i = 0; i < n; i++) {
		d2 = d2.remove(i * 2 + 1);
	}
	console.log("rm n/e", Date.now() - start, d2.count, d2.depth, d2);

	start = Date.now();
	for (var i = 0; i < n; i++) {
		d2 = d2.remove(i * 2);
	}
	console.log("rm all", Date.now() - start, d2.count, d2.depth, d2);

}
