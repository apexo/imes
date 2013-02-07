function ChannelControl(target, userStatus) {
	this.userStatus = userStatus;
	this.target = target;
	this.channel = null;
	userStatus.onupdate.addListener(this.statusUpdated, this);
	target.addEventListener("click", this.clickHandler.bind(this));
}

ChannelControl.prototype.statusUpdated = function(status) {
	this.channel = status.channel;
	if (status.paused) {
		this.target.classList.remove("pause-button");
		this.target.classList.add("resume-button");
	} else {
		this.target.classList.remove("resume-button");
		this.target.classList.add("pause-button");
	}
}

ChannelControl.prototype.clickHandler = function(event) {
	event.preventDefault();
	if (this.channel) {
		var url = this.userStatus.backendUrl() + "channel/" + this.channel;
		var doPause = this.target.classList.contains("pause-button");
		ajax_post(url, {"paused": doPause}, function() {});
	}
}
