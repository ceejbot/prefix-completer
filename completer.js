'use strict';

const P = require('bluebird');
const redis = require('redis');

const ZKEY = 'COMP'; // default key used to store sorted set
const RANGELEN = 50; // suggested by antirez

module.exports = class Completer
{
	static create(options)
	{
		const c = new Completer(options);
		return P.promisifyAll(c);
	}

	constructor(opts)
	{
		opts = opts || {};
		if (opts.client)
			this.redis = opts.client;
		else
			this.redis = redis.createClient(opts.redis);

		if (opts.db)
			this.redis.select(opts.db);

		this.rediskey = opts.key || ZKEY;
	}

	// callback(err, exactCompletionAdded)
	add(input, callback)
	{
		if (!input)
			return callback();

		if (Array.isArray(input))
			return this.addList(input, callback);

		if (typeof input !== 'string')
			return callback();

		const word = input.trim().toLowerCase();
		if (word.length === 0)
			return callback();

		this.redis.zadd(this.rediskey, 0, word + '*', (err, numadded) =>
		{
			if (err) return callback(err);
			if (numadded === 0) return callback(); // word already in list

			var pending = 0;
			for (var i = 0; i < word.length; i++)
			{
				var prefix = word.slice(0, i);
				pending++;
				this.redis.zadd(this.rediskey, 0, prefix, (err, numadded) =>
				{
					--pending || callback(err, word);
				});
			}
		});
	}

	// callback(err, newWordsArray)
	addList(input, callback)
	{
		var results = [];
		var pending = 0;
		for (var i = 0; i < input.length; i++)
		{
			pending++;
			this.add(input[i], (err, word) =>
			{
				if (!err && word)
					results.push(word);
				--pending || callback(err, results);
			});
		}
	}

	// callback(err, exactprefix, completionsArray)
	complete(input, count, callback)
	{
		var self = this;
		var results = [];

		if (!input || typeof input !== 'string')
			return callback(null, '', []); // don't complete empty strings

		var prefix = input.trim().toLowerCase();
		if (prefix.length === 0)
			return callback(null, '', []);

		if (typeof count === 'function')
		{
			callback = count;
			count = 50;
		}

		self.redis.zrank(self.rediskey, prefix, function(err, start)
		{
			if (err)
				return callback(err, prefix, []);

			if (!start)
			{
				// No hits. The prefix might be an exact match for a leaf, however.
				self.redis.zrank(self.rediskey, prefix + '*', function(err, position)
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
				self.redis.zrange(self.rediskey, start, start + RANGELEN - 1, continuer);
			};

			self.redis.zrange(self.rediskey, start, start + RANGELEN - 1, continuer);
		});
	}

	// callback(err, boolRemoved)
	remove(input, callback)
	{
		var self = this;
		var removed = false;
		var commonPrefix;

		if (!input || typeof input !== 'string')
			return callback(null, false);

		var word = input.trim().toLowerCase();
		if (word.length === 0)
			return callback(null, false);

		self.redis.zrank(self.rediskey, word, function(err, rank)
		{
			if (err) return callback(err);
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

						if (item.length === 0 || (item === commonPrefix) || (item[item.length - 1] === '*') || (item.length >= word.length))
						{
							left = left - range.length + i + 1;
							pending++;
							self.redis.zremrangebyrank(self.rediskey, left, start - 1, function(err, count)
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
						self.redis.zrange(self.rediskey, right - RANGELEN + 1, right - 1, continuer);
					}

					--pending || callback(err, removed);
				};

				// Yes, we're going backwards but not using zrevrange.
				pending++;
				self.redis.zrange(self.rediskey, right - RANGELEN + 1, right - 1, continuer);
			}

			if (rank === null)
			{
				// No matches for us exactly means that we are *not* a prefix
				// for another completion. Therefore we have to climb the tree
				// removing all prefixes for ourself until we hit another leaf.
				self.redis.zrank(self.rediskey, word + '*', function(err, start)
				{
					if (err) return callback(err);
					if (start === null)
						return; // we're not in the dict at all

					// Examine the entry immediately after us & find its common prefix, if one
					// exists. We will stop removing entries when we encounter that prefix.
					pending++;
					self.redis.zrange(self.rediskey, start, start + 1, function(err, range)
					{
						if (err) return callback(err);
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
			self.redis.zrem(self.rediskey, word + '*', function(err, count)
			{
				if (count === 1) removed = true;
				--pending || callback(err, removed);
			});
		});
	}

	leaves(callback)
	{
		var self = this;

		self.redis.zcard(self.rediskey, (err, count) =>
		{
			if (err) return callback(err);
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
				self.redis.zrange(self.rediskey, start, start + RANGELEN - 1, continuer);
			};

			self.redis.zrange(self.rediskey, start, start + RANGELEN - 1, continuer);
		});
	}

	// Calculate space usage info, to satisfy my curiosity about overhead.
	// callback(err, resultsHash)
	statistics(callback)
	{
		var self = this;
		self.redis.zcard(self.rediskey, (err, count) =>
		{
			if (err) return callback(err);
			var start = 0;
			var results = {
				leaves: 0,
				leaflen: 0,
				prefixlen: 0,
				total: count
			};

			function continuer(err, range)
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
				self.redis.zrange(self.rediskey, start, start + RANGELEN - 1, continuer);
			}

			self.redis.zrange(self.rediskey, start, start + RANGELEN - 1, continuer);
		});
	}

	dump(callback)
	{
		// careful about calling this on giant dictionaries; use for debugging
		this.redis.zrange(this.rediskey, 0, -1, callback);
	}

	// callback(err, numdeleted)
	// wildly destructive, of course
	flush(callback)
	{
		this.redis.del(this.rediskey, callback);
	}
};
