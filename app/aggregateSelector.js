function AggregateSelector(target, settings, userStatus, layoutManager) {
	this.target = target;
	this.layoutManager = layoutManager;
	userStatus.onupdate.addListener(this.updateMaybe, this);
	settings.onupdate.addListener(this.updateMaybe, this);
	this.settings = settings;
	this.userStatus = userStatus;

	this.aggregate = null;
	this.requestedAggregate = null;
	this.oldAggregates = [];

	this.onaggregatechange = new Event();

	target.addEventListener("change", this.handleSelect.bind(this), false);

	this.updateMaybe();
}

AggregateSelector.prototype.updateMaybe = function() {
	if (!this.settings.ready || !this.userStatus.status) {
		return;
	}
	var aggregates = this.settings.arrayify(this.settings.aggregates).sort();
	var newAggregate = this.userStatus.status.aggregate || "";

	if (JSON.stringify(aggregates) !== JSON.stringify(this.oldAggregates)) {
		this.target.innerHTML = "";
		for (var i = 0; i < aggregates.length; i++) {
			var a = aggregates[i];
			addOption(this.target, a, a);
		}
		addOption(this.target, "[None]", "");

		if (!this.aggregate || aggregates.indexOf(this.aggregate) >= 0) {
			this.target.value = this.aggregate || "";
		} else {
			console.log("user seems to be member of a non-existing aggregate:", this.aggregate);
			this.target.value = "";
		}

		this.layoutManager.layout();

		this.oldAggregates = aggregates;
	}

	if (this.requestedAggregate !== null && this.requestedAggregate === newAggregate) {
		console.log("confirm change aggregate", this.aggregate, "->", newAggregate);
		this.aggregate = newAggregate;
		this.requestedAggregate = null;
		this.onaggregatechange.fire(this, newAggregate);
		this.target.disabled = false;
		return;
	}

	if (this.aggregate !== newAggregate) {
		if (!newAggregate || this.oldAggregates.indexOf(newAggregate) >= 0) {
			this.target.value = newAggregate || "";
			this.update(newAggregate);
		} else {
			console.log("user seems to be member of a non-existing aggregate:", newAggregate);
			this.target.value = "";
			this.update(newAggregate);
		}
	}
}

AggregateSelector.prototype.update = function(aggregate) {
	if (aggregate !== this.aggregate) {
		console.log("request change aggregate", this.aggregate, "->", aggregate);
		this.requestedAggregate = aggregate;
		this.userStatus.setUserAggregate(aggregate);
		this.target.disabled = true;
	}
}

AggregateSelector.prototype.handleSelect = function() {
	this.update(this.target.value);
}
