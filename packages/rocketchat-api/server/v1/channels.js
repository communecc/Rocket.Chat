//Returns the channel IF found otherwise it will return the failure of why it didn't. Check the `statusCode` property
function findChannelById({ roomId, checkedArchived = true }) {
	if (!roomId || !roomId.trim()) {
		throw new Meteor.Error('error-roomid-param-not-provided', 'The parameter "roomId" is required');
	}

	const room = RocketChat.models.Rooms.findOneById(roomId, { fields: RocketChat.API.v1.defaultFieldsToExclude });

	if (!room || room.t !== 'c') {
		throw new Meteor.Error('error-room-not-found', `No channel found by the id of: ${roomId}`);
	}

	if (checkedArchived && room.archived) {
		throw new Meteor.Error('error-room-archived', `The channel, ${room.name}, is archived`);
	}

	return room;
}

RocketChat.API.v1.addRoute('channels.addAll', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('addAllUserToRoom', findResult._id);
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.addModerator', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		const user = this.getUserFromParams();

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('addRoomModerator', findResult._id, user._id);
		});

		return RocketChat.API.v1.success();
	}
});

RocketChat.API.v1.addRoute('channels.addOwner', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		const user = this.getUserFromParams();

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('addRoomOwner', findResult._id, user._id);
		});

		return RocketChat.API.v1.success();
	}
});

RocketChat.API.v1.addRoute('channels.archive', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('archiveRoom', findResult._id);
		});

		return RocketChat.API.v1.success();
	}
});

RocketChat.API.v1.addRoute('channels.cleanHistory', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		if (!this.bodyParams.latest) {
			return RocketChat.API.v1.failure('Body parameter "latest" is required.');
		}

		if (!this.bodyParams.oldest) {
			return RocketChat.API.v1.failure('Body parameter "oldest" is required.');
		}

		const latest = new Date(this.bodyParams.latest);
		const oldest = new Date(this.bodyParams.oldest);

		let inclusive = false;
		if (typeof this.bodyParams.inclusive !== 'undefined') {
			inclusive = this.bodyParams.inclusive;
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('cleanChannelHistory', { roomId: findResult._id, latest, oldest, inclusive });
		});

		return RocketChat.API.v1.success();
	}
});

RocketChat.API.v1.addRoute('channels.close', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId, checkedArchived: false });

		const sub = RocketChat.models.Subscriptions.findOneByRoomIdAndUserId(findResult._id, this.userId);

		if (!sub) {
			return RocketChat.API.v1.failure(`The user/callee is not in the channel "${findResult.name}.`);
		}

		if (!sub.open) {
			return RocketChat.API.v1.failure(`The channel, ${findResult.name}, is already closed to the sender`);
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('hideRoom', findResult._id);
		});

		return RocketChat.API.v1.success();
	}
});

RocketChat.API.v1.addRoute('channels.create', { authRequired: true }, {
	post: function() {
		if (!RocketChat.authz.hasPermission(this.userId, 'create-p')) {
			return RocketChat.API.v1.unauthorized();
		}

		if (!this.bodyParams.name) {
			return RocketChat.API.v1.failure('Body param "name" is required');
		}

		if (this.bodyParams.members && !_.isArray(this.bodyParams.members)) {
			return RocketChat.API.v1.failure('Body param "members" must be an array if provided');
		}

		let readOnly = false;
		if (typeof this.bodyParams.readOnly !== 'undefined') {
			readOnly = this.bodyParams.readOnly;
		}

		let id;
		Meteor.runAsUser(this.userId, () => {
			id = Meteor.call('createChannel', this.bodyParams.name, this.bodyParams.members ? this.bodyParams.members : [], readOnly);
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(id.rid, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.delete', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId, checkedArchived: false });

		//The find method returns either with the group or the failur

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('eraseRoom', findResult._id);
		});

		return RocketChat.API.v1.success({
			channel: findResult
		});
	}
});

RocketChat.API.v1.addRoute('channels.getIntegrations', { authRequired: true }, {
	get: function() {
		if (!RocketChat.authz.hasPermission(this.userId, 'manage-integrations')) {
			return RocketChat.API.v1.unauthorized();
		}

		const findResult = findChannelById({ roomId: this.queryParams.roomId, checkedArchived: false });

		let includeAllPublicChannels = true;
		if (typeof this.queryParams.includeAllPublicChannels !== 'undefined') {
			includeAllPublicChannels = this.queryParams.includeAllPublicChannels === 'true';
		}

		let ourQuery = {
			channel: `#${findResult.name}`
		};

		if (includeAllPublicChannels) {
			ourQuery.channel = {
				$in: [ourQuery.channel, 'all_public_channels']
			};
		}

		const { offset, count } = this.getPaginationItems();
		const { sort, fields, query } = this.parseJsonQuery();

		ourQuery = Object.assign({}, query, ourQuery);

		const integrations = RocketChat.models.Integrations.find(ourQuery, {
			sort: sort ? sort : { _createdAt: 1 },
			skip: offset,
			limit: count,
			fields: Object.assign({}, fields, RocketChat.API.v1.defaultFieldsToExclude)
		}).fetch();

		return RocketChat.API.v1.success({
			integrations,
			count: integrations.length,
			offset,
			total: RocketChat.models.Integrations.find(ourQuery).count()
		});
	}
});

RocketChat.API.v1.addRoute('channels.history', { authRequired: true }, {
	get: function() {
		const findResult = findChannelById({ roomId: this.queryParams.roomId, checkedArchived: false });

		let latestDate = new Date();
		if (this.queryParams.latest) {
			latestDate = new Date(this.queryParams.latest);
		}

		let oldestDate = undefined;
		if (this.queryParams.oldest) {
			oldestDate = new Date(this.queryParams.oldest);
		}

		let inclusive = false;
		if (this.queryParams.inclusive) {
			inclusive = this.queryParams.inclusive;
		}

		let count = 20;
		if (this.queryParams.count) {
			count = parseInt(this.queryParams.count);
		}

		let unreads = false;
		if (this.queryParams.unreads) {
			unreads = this.queryParams.unreads;
		}

		let result;
		Meteor.runAsUser(this.userId, () => {
			result = Meteor.call('getChannelHistory', { rid: findResult._id, latest: latestDate, oldest: oldestDate, inclusive, count, unreads });
		});

		return RocketChat.API.v1.success({
			messages: result && result.messages ? result.messages : []
		});
	}
});

RocketChat.API.v1.addRoute('channels.info', { authRequired: true }, {
	get: function() {
		const findResult = findChannelById({ roomId: this.queryParams.roomId, checkedArchived: false });

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.invite', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		const user = this.getUserFromParams();

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('addUserToRoom', { rid: findResult._id, username: user.username });
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.join', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('joinRoom', findResult._id, this.bodyParams.joinCode);
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.kick', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		const user = this.getUserFromParams();

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('removeUserFromRoom', { rid: findResult._id, username: user.username });
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.leave', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('leaveRoom', findResult._id);
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.list', { authRequired: true }, {
	get: {
		//This is like this only to provide an example of how we routes can be defined :X
		action: function() {
			const { offset, count } = this.getPaginationItems();
			const { sort, fields, query } = this.parseJsonQuery();

			const ourQuery = Object.assign({}, query, { t: 'c' });

			const rooms = RocketChat.models.Rooms.find(ourQuery, {
				sort: sort ? sort : { name: 1 },
				skip: offset,
				limit: count,
				fields: Object.assign({}, fields, RocketChat.API.v1.defaultFieldsToExclude)
			}).fetch();

			return RocketChat.API.v1.success({
				channels: rooms,
				count: rooms.length,
				offset,
				total: RocketChat.models.Rooms.find(ourQuery).count()
			});
		}
	}
});

RocketChat.API.v1.addRoute('channels.list.joined', { authRequired: true }, {
	get: function() {
		const { offset, count } = this.getPaginationItems();
		const { sort, fields } = this.parseJsonQuery();
		let rooms = _.pluck(RocketChat.models.Subscriptions.findByTypeAndUserId('c', this.userId).fetch(), '_room');
		const totalCount = rooms.length;

		rooms = RocketChat.models.Rooms.processQueryOptionsOnResult(rooms, {
			sort: sort ? sort : { name: 1 },
			skip: offset,
			limit: count,
			fields: Object.assign({}, fields, RocketChat.API.v1.defaultFieldsToExclude)
		});

		return RocketChat.API.v1.success({
			channels: rooms,
			offset,
			count: rooms.length,
			total: totalCount
		});
	}
});

RocketChat.API.v1.addRoute('channels.open', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId, checkedArchived: false });

		const sub = RocketChat.models.Subscriptions.findOneByRoomIdAndUserId(findResult._id, this.userId);

		if (!sub) {
			return RocketChat.API.v1.failure(`The user/callee is not in the channel "${findResult.name}".`);
		}

		if (sub.open) {
			return RocketChat.API.v1.failure(`The channel, ${findResult.name}, is already open to the sender`);
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('openRoom', findResult._id);
		});

		return RocketChat.API.v1.success();
	}
});

RocketChat.API.v1.addRoute('channels.removeModerator', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		const user = this.getUserFromParams();

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('removeRoomModerator', findResult._id, user._id);
		});

		return RocketChat.API.v1.success();
	}
});

RocketChat.API.v1.addRoute('channels.removeOwner', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		const user = this.getUserFromParams();

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('removeRoomOwner', findResult._id, user._id);
		});

		return RocketChat.API.v1.success();
	}
});

RocketChat.API.v1.addRoute('channels.rename', { authRequired: true }, {
	post: function() {
		if (!this.bodyParams.name || !this.bodyParams.name.trim()) {
			return RocketChat.API.v1.failure('The bodyParam "name" is required');
		}

		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		if (findResult.name === this.bodyParams.name) {
			return RocketChat.API.v1.failure('The channel name is the same as what it would be renamed to.');
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('saveRoomSettings', findResult._id, 'roomName', this.bodyParams.name);
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.setDescription', { authRequired: true }, {
	post: function() {
		if (!this.bodyParams.description || !this.bodyParams.description.trim()) {
			return RocketChat.API.v1.failure('The bodyParam "description" is required');
		}

		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		if (findResult.description === this.bodyParams.description) {
			return RocketChat.API.v1.failure('The channel description is the same as what it would be changed to.');
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('saveRoomSettings', findResult._id, 'roomDescription', this.bodyParams.description);
		});

		return RocketChat.API.v1.success({
			description: this.bodyParams.description
		});
	}
});

RocketChat.API.v1.addRoute('channels.setJoinCode', { authRequired: true }, {
	post: function() {
		if (!this.bodyParams.joinCode || !this.bodyParams.joinCode.trim()) {
			return RocketChat.API.v1.failure('The bodyParam "joinCode" is required');
		}

		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('saveRoomSettings', findResult._id, 'joinCode', this.bodyParams.joinCode);
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.setPurpose', { authRequired: true }, {
	post: function() {
		if (!this.bodyParams.purpose || !this.bodyParams.purpose.trim()) {
			return RocketChat.API.v1.failure('The bodyParam "purpose" is required');
		}

		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		if (findResult.description === this.bodyParams.purpose) {
			return RocketChat.API.v1.failure('The channel purpose (description) is the same as what it would be changed to.');
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('saveRoomSettings', findResult._id, 'roomDescription', this.bodyParams.purpose);
		});

		return RocketChat.API.v1.success({
			purpose: this.bodyParams.purpose
		});
	}
});

RocketChat.API.v1.addRoute('channels.setReadOnly', { authRequired: true }, {
	post: function() {
		if (typeof this.bodyParams.readOnly === 'undefined') {
			return RocketChat.API.v1.failure('The bodyParam "readOnly" is required');
		}

		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		if (findResult.ro === this.bodyParams.readOnly) {
			return RocketChat.API.v1.failure('The channel read only setting is the same as what it would be changed to.');
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('saveRoomSettings', findResult._id, 'readOnly', this.bodyParams.readOnly);
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.setTopic', { authRequired: true }, {
	post: function() {
		if (!this.bodyParams.topic || !this.bodyParams.topic.trim()) {
			return RocketChat.API.v1.failure('The bodyParam "topic" is required');
		}

		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		if (findResult.topic === this.bodyParams.topic) {
			return RocketChat.API.v1.failure('The channel topic is the same as what it would be changed to.');
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('saveRoomSettings', findResult._id, 'roomTopic', this.bodyParams.topic);
		});

		return RocketChat.API.v1.success({
			topic: this.bodyParams.topic
		});
	}
});

RocketChat.API.v1.addRoute('channels.setType', { authRequired: true }, {
	post: function() {
		if (!this.bodyParams.type || !this.bodyParams.type.trim()) {
			return RocketChat.API.v1.failure('The bodyParam "type" is required');
		}

		const findResult = findChannelById({ roomId: this.bodyParams.roomId });

		if (findResult.t === this.bodyParams.type) {
			return RocketChat.API.v1.failure('The channel type is the same as what it would be changed to.');
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('saveRoomSettings', findResult._id, 'roomType', this.bodyParams.type);
		});

		return RocketChat.API.v1.success({
			channel: RocketChat.models.Rooms.findOneById(findResult._id, { fields: RocketChat.API.v1.defaultFieldsToExclude })
		});
	}
});

RocketChat.API.v1.addRoute('channels.unarchive', { authRequired: true }, {
	post: function() {
		const findResult = findChannelById({ roomId: this.bodyParams.roomId, checkedArchived: false });

		if (!findResult.archived) {
			return RocketChat.API.v1.failure(`The channel, ${findResult.name}, is not archived`);
		}

		Meteor.runAsUser(this.userId, () => {
			Meteor.call('unarchiveRoom', findResult._id);
		});

		return RocketChat.API.v1.success();
	}
});
