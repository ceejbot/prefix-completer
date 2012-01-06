var redis = require('redis');

var ZKEY = 'completer'; // suffix of key used to store sorted set

function Completer(options)
{
	this.options = options = options || {};
	
	if ('client' in options)
		this.redis = options.client;
	else if (('port' in options) || ('host' in options))
	{
		var port = options.port? parseInt(options.port) : 6379;
		var host = options.host || 'localhost';
		this.redis = redis.createClient(options.port, options.host);
	}
	else
		this.redis = redis.createClient();

	if ('db' in options)
		this.redis.select(options.db);

	if ('prefix' in options)
		this.zkey = options.prefix + ZKEY;
	else
		this.zkey = ZKEY;
};
exports.Completer = Completer;

Completer.prototype.client = function()
{
	return this.redis;
};

Completer.prototype.rediskey = function()
{
	return this.zkey;
};

Completer.prototype.add = function(input, callback)
{
	var self = this;
	var word = input.trim().toLowerCase();
	self.redis.zrank(self.zkey, input+'*', function(err, position)
	{
		if (position !== null)
			return callback(null, null); // word already in list

		for (var i=0; i < word.length; i++)
		{
			var prefix = word.slice(0, i);
			self.redis.zadd(self.zkey, 0, prefix);
		}
		self.redis.zadd(self.zkey, 0, word+'*', callback(null, word)); // splat to indicate leaf
	});
};

Completer.prototype.addList = function(input, callback)
{
	var self = this;
	var results = [];
	var pending = 0;
	for (var i=0; i<input.length; i++)
	{
		pending++;
		self.add(input[i], function(err, word)
		{
			if (!err && word)
				results.push(word);
			pending-- || callback(err, results);
		});
	}
	pending-- || callback(err, results);
};

Completer.prototype.remove = function(input, callback)
{
	var self = this;
	var removed = false;
	var word = input.trim().toLowerCase();

	self.redis.zrank(self.zkey, word, function(err, rank)
	{
		var pending = 0;
		if (rank === null)
		{
			// No matches for us exactly means that we are *not* a prefix
			// for another completion. Therefore we have to climb the tree 
			// removing all prefixes for ourself until we hit another leaf.
			pending++;
			self.redis.zrank(self.zkey, word+'*', function(err, start)
			{
				var rangelen = 2; // SHOULD BE 50
				var right = start; // moves left by rangelen with each pass
				var left = start; 
				var done = false;
				
				var continuer = function(err, range)
				{
					for (var i = range.length - 1; i >= 0; i--)
					{
						var item = range[i];						
						if ((item[item.length - 1] === '*') || (item.length >= word.length))
						{
							left = left - range.length + i + 1;
							pending++;
							self.redis.zremrangebyrank(self.zkey, left, start - 1, function(err, count)
							{
								pending-- || callback(err, removed);
							});
							done = true;
							break;
						}
					}
					
					if (!done)
					{
						right -= rangelen;
						left -= rangelen;
						pending++;
						self.redis.zrange(self.zkey, right - rangelen + 1, right - 1, continuer);
					}

					pending-- || callback(err, removed);
				};
				
				// Yes, we're going backwards but not using zrevrange.
				self.redis.zrange(self.zkey, right - rangelen + 1, right - 1, continuer);
			});
		}
		
		self.redis.zrem(self.zkey, word+'*', function(err, count)
		{
			if (count == 1) removed = true;
			pending-- || callback(err, removed);
		});

	});
};

Completer.prototype.complete = function(input, count, callback)
{
	var self = this;
	var prefix = input.trim().toLowerCase();
	var rangelen = 50; // Suggested by antirez
	var results = [];

	self.redis.zrank(self.zkey, prefix, function(err, start)
	{
		if (err || start === null)
		{
			// No more hits. We might be an exact match for a leaf, however.
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

				// have we moved past the range of relevant results?
				if ((item.length < prefix.length) || (item.slice(0, prefix.length) !== prefix))
					return callback(null, prefix, results);
				
				// we found a leaf node
				if (item[item.length - 1] === '*')
				{
					results.push(item.slice(0, -1)); // trim the *
					if (results.length >= count)
						return callback(null, prefix, results);
				}
			}
			
			start += rangelen;
			self.redis.zrange(self.zkey, start, start + rangelen - 1, continuer);
		};

		self.redis.zrange(self.zkey, start, start + rangelen - 1, continuer);
	});
};

Completer.prototype.flush = function(callback)
{
	this.redis.del(this.zkey, callback);
};

exports.create = function(options)
{
	var completer = new Completer(options);
	return completer;
};