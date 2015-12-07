var redis = require('redis');

var ZKEY = 'COMP'; // default key used to store sorted set
var RANGELEN = 50; // suggested by antirez

function Completer(options)
{
	options = options || {};
	var port, host;

	if (options.client)
		this.redis = options.client;
	else
	{
		port = options.port ? parseInt(options.port, 10) : 6379;
		host = options.host || 'localhost';
		this.redis = redis.createClient(port, host);
	}

	if (options.db)
		this.redis.select(options.db);

	if (options.key)
		this.zkey = options.key;
	else
		this.zkey = ZKEY;
}
exports.Completer = Completer;

Completer.prototype.client = function()
{
	return this.redis;
};

Completer.prototype.rediskey = function()
{
	return this.zkey;
};

// callback(err, exactCompletionAdded)
Completer.prototype.add = function(input, callback)
{
	var self = this;

	if (!input)
		return callback(null, null);

	if (Array.isArray(input))
		return this.addList(input, callback);

	if (typeof input !== 'string')
		return callback(new Error('input not string'));

	var word = input.trim().toLowerCase();
	if (word.length === 0)
		return callback(new Error('no empty strings'));

	self.redis.zadd(self.zkey, 0, word+'*', function(err, numadded)
	{
		if (err) return callback(err);
		if (numadded === 0) return callback(null, null); // word already in list

		var pending = 0;
		for (var i=0; i < word.length; i++)
		{
			var prefix = word.slice(0, i);
			pending++;
			self.redis.zadd(self.zkey, 0, prefix, function(err, numadded)
			{
				--pending || callback(err, word);
			});
		}
	});
};

// callback(err, newWordsArray)
Completer.prototype.addList = function(input, callback)
{
	var self = this;
	var results = [];
	var pending = 0;
	for (var i = 0; i < input.length; i++)
	{
		pending++;
		self.add(input[i], function(err, word)
		{
			if (!err && word)
				results.push(word);
			--pending || callback(err, results);
		});
	}
};

// callback(err, boolRemoved)
Completer.prototype.remove = function(input, callback)
{
	var self = this;
	var removed = false;
	var commonPrefix;

	if (!input)
		return callback(null, false);
	if (typeof input !== 'string')
		return callback(new Error('remove() input not a string'));

	var word = input.trim().toLowerCase();
	if (word.length === 0)
		return callback(null, false);

	self.redis.zrank(self.zkey, word, function(err, rank)
	{
		var pending = 1;

		function removePrefixes(start)
		{
			var right = start; // moves left by rangelen with each pass
			var left = start;
			var done = false;

			var continuer = function(err, range)
			{
				for (var i = range.length - 1; i >= 0; i--)
				{
					var item = range[i];

					if (!item.length || (item === commonPrefix) || (item[item.length - 1] === '*') || (item.length >= word.length))
					{
						left = left - range.length + i + 1;
						pending++;
						self.redis.zremrangebyrank(self.zkey, left, start - 1, function(err, count)
						{
							--pending || callback(err, removed);
						});
						done = true;
						break;
					}
				}

				if (!done)
				{
					right -= RANGELEN;
					left -= RANGELEN;
					pending++;
					self.redis.zrange(self.zkey, right - RANGELEN + 1, right - 1, continuer);
				}

				--pending || callback(err, removed);
			};

			// Yes, we're going backwards but not using zrevrange.
			pending++;
			self.redis.zrange(self.zkey, right - RANGELEN + 1, right - 1, continuer);
		}

		if (rank === null)
		{
			// No matches for us exactly means that we are *not* a prefix
			// for another completion. Therefore we have to climb the tree
			// removing all prefixes for ourself until we hit another leaf.
			self.redis.zrank(self.zkey, word + '*', function(err, start)
			{
				if (start === null)
					return; // we're not in the dict at all

				// Examine the entry immediately after us & find its common prefix, if one
				// exists. We will stop removing entries when we encounter that prefix.
				pending++;
				self.redis.zrange(self.zkey, start, start + 1, function(err, range)
				{
					--pending;
					var nextEntry = range[0];

					// Find the common prefix between us & the next entry.
					if (nextEntry)
					{
						var ptr = 0;
						var maxlen = Math.min(word.length, nextEntry.length);
						while (word[ptr] === nextEntry[ptr] && (ptr < maxlen))
							ptr++;

						commonPrefix = word.substring(0, ptr);
					}

					// Now start removing.
					removePrefixes(start);
				});
			});
		}

		// Remove the leaf node that represents us.
		self.redis.zrem(self.zkey, word+'*', function(err, count)
		{
			if (count === 1) removed = true;
			--pending || callback(err, removed);
		});
	});
};

// callback(err, exactprefix, completionsArray)
Completer.prototype.complete = function(input, count, callback)
{
	var self = this;
	var results = [];

	if (!input)
		return callback(null, '', []); // don't complete empty strings
	if (typeof input !== 'string')
		return callback(new Error('complete() input not a string'));

	var prefix = input.trim().toLowerCase();
	if (prefix.length === 0)
		return callback(null, '', []);

	if (typeof count === 'function')
	{
		callback = count;
		count = 50;
	}

	self.redis.zrank(self.zkey, prefix, function(err, start)
	{
		if (err)
			return callback(err, prefix, []);

		if (!start)
		{
			// No hits. The prefix might be an exact match for a leaf, however.
			self.redis.zrank(self.zkey, prefix+'*', function(err, position)
			{
				if (position !== null)
					results.push(prefix);
				return callback(err, prefix, results);
			});
			return;
		}

		var continuer = function(err, range)
		{
			if (err || !range || range.length === 0)
				return callback(err, prefix, results);

			for (var i = 0; i < range.length; i++)
			{
				var item = range[i];

				// Have we moved past the range of relevant results?
				if ((item.length < prefix.length) || (item.slice(0, prefix.length) !== prefix))
					return callback(null, prefix, results);

				// We found a leaf node.
				if (item[item.length - 1] === '*')
				{
					results.push(item.slice(0, -1)); // trim the *
					if (results.length >= count)
						return callback(null, prefix, results);
				}
			}

			start += RANGELEN;
			self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
		};

		self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
	});
};

// callback(err, numdeleted)
Completer.prototype.flush = function(callback)
{
	this.redis.del(this.zkey, callback);
};

// Calculate space usage info, to satisfy my curiosity about overhead.
// callback(err, resultsHash)
Completer.prototype.statistics = function(callback)
{
	var self = this;
	self.redis.zcard(self.zkey, function(err, count)
	{
		var start = 0;
		var results =
		{
			leaves: 0,
			leaflen: 0,
			prefixlen: 0,
			total: count
		};

		var continuer = function(err, range)
		{
			if (err || !range || range.length === 0)
				return callback(err, results);

			for (var i = 0; i < range.length; i++)
			{
				var item = range[i];
				if (item[item.length - 1] === '*')
				{
					results.leaves += 1;
					results.leaflen += (item.length - 1);
				}
				else
					results.prefixlen += item.length;
			}

			start += RANGELEN;
			self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
		};

		self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
	});
};

Completer.prototype.leaves = function(callback)
{
	var self = this;

	self.redis.zcard(self.zkey, function(err, count)
	{
		var start = 0;
		var results = [];

		var continuer = function(err, range)
		{
			if (err || !range || range.length === 0)
				return callback(err, results);

			for (var i = 0; i < range.length; i++)
			{
				var item = range[i];
				if (item[item.length - 1] === '*')
					results.push(item);
			}

			start += RANGELEN;
			self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
		};

		self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
	});
};

Completer.prototype.dump = function(callback)
{
	// careful about calling this on giant dictionaries; use for debugging
	var self = this;
	self.redis.zrange(self.zkey, 0, -1, callback);
};

exports.create = function(options)
{
	return new Completer(options);
};
