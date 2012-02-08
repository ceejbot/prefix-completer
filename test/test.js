var redis = require('redis');
var should = require('chai').should();
	
var prefixcompleter = require('../completer');

var wordlist = [
	'aaaaa',
	'aaaab',
	'aaaabbbb',
	'restrain',
	'restrained',
	'restraining',
	'splat',
	'splatted',
	'splatter',
	'splatterpunk',
	'splatterpunks',
	'zzzzz'
];

describe('prefix-completer', function()
{
	var config = {
		db: 0,
		keyprefix: '_completer_test_'
	};
	var completer;

	before(function()
	{
		completer = prefixcompleter.create(config);
	});
	
	after(function()
	{
		completer.flush(function(err, count)
		{
			if (err) throw err;
			count.should.equal(1);
		});
	});
	
	describe('#create()', function()
	{
		it('creates a prefix completer with the passed-in options', function()
		{
			var rc = completer.client();
			(rc instanceof redis.RedisClient).should.be.ok;
			if (config.port !== undefined)
				rc.port.should.equal(config.port);
			else
				rc.port.should.equal(6379);
			if (config.host !== undefined)
				rc.host.should.equal(config.host);
			else
				rc.host.should.equal('127.0.0.1');
		});
		it('sets the redis key namespace', function()
		{
			completer.rediskey().indexOf(config.keyprefix).should.equal(0);
		});
	});
	
	describe('#add()', function()
	{
		it('returns the exact string added', function(done)
		{
			var testWord = ' nixy Nox ';
			completer.add(testWord, function(err, added)
			{
				if (err) throw err;
				added.should.equal('nixy nox');
				done();
			});
		});
		it('doesn\'t add a string that already exists', function(done)
		{
			completer.add('nixy nox', function(err, added)
			{
				if (err) throw err;
				should.not.exist(added);
				done();
			});
		});
		it('can add very long words', function(done)
		{
			var longword = 'supercalifragilisticexpialidocious';
			completer.add(longword, function(err, added)
			{
				if (err) throw err;
				added.should.equal(longword);
				done();
			});
		});
	});
	describe('#addList()', function()
	{
		it('adds all strings in the passed-in list', function(done)
		{
			completer.addList(wordlist, function(err, results)
			{
				if (err) throw err;
				results.length.should.equal(wordlist.length);
				done();
			});
		});
	});
	describe('#complete()', function(done)
	{
		it('finds completions', function(done)
		{
			completer.complete('nixy', 10, function(err, prefix, completions)
			{
				if (err) throw err;
				completions.length.should.equal(1);
				completions[0].should.equal('nixy nox');
				done();
			});
		});
		it('finds a completion for an exact match', function(done)
		{
			completer.complete(' nixy Nox ', 10, function(err, prefix, completions)
			{
				if (err) throw err;
				completions.length.should.equal(1);
				completions[0].should.equal('nixy nox');
				done();
			});
		});
		it('returns the trimmed string used for matching', function(done)
		{
			completer.complete('   RESTR', 50, function(err, prefix, completions)
			{
				if (err) throw err;
				prefix.should.equal('restr');
				done();
			});
		});
		it('returns a list of completions', function(done)
		{
			completer.complete('restr', 50, function(err, prefix, completions)
			{
				if (err) throw err;
				completions.length.should.equal(3);
				done();
			});
		});
		it('returns at most the requested number of completions', function(done)
		{
			completer.complete('restr', 1, function(err, prefix, completions)
			{
				if (err) throw err;
				completions.length.should.equal(1);
				done();
			});
		});
		it('returns an empty list when no completions exist', function(done)
		{
			completer.complete('xxxxxx', 1, function(err, prefix, completions)
			{
				if (err) throw err;
				completions.length.should.equal(0);
				done();
			});
		});
	});
	describe('#remove()', function()
	{
		it('removes the specified completion', function(done)
		{
			completer.remove('zzzzz', function(err, removed)
			{
				if (err) throw err;
				removed.should.be.ok;
				done();
			});
		});
		it('removes all prefixes for removed completion', function(done)
		{
			completer.complete('zzz', 50, function(err, prefix, completions)
			{
				if (err) throw err;
				completions.length.should.equal(0);
				done();
			});
		});
		it("doesn't remove prefixes for other completions", function(done)
		{
			var key = completer.rediskey();
			var r = completer.client();
			
			r.zcard(key, function(err, startingSize)
			{
				if (err) throw err;
				completer.remove('aaaab', function(err, removed)
				{
					if (err) throw err;
					removed.should.be.ok;
					r.zcard(key, function(err, endingSize)
					{
						if (err) throw err;
						endingSize.should.equal(startingSize - 1);
						done();
					});
				});
			});
		});
		it("doesn't remove completions for which the removed string is a prefix", function(done)
		{
			completer.complete('aaaab', 50, function(err, prefix, completions)
			{
				if (err) throw err;
				completions.length.should.equal(1);
				completions[0].should.equal('aaaabbbb');
				done();
			});
		});
		it("doesn't remove unrelated adjacent completions", function(done)
		{
			completer.complete('splatterpunks', 50, function(err, prefix, completions)
			{
				if (err) throw err;
				completions.length.should.equal(1);
				completions[0].should.equal('splatterpunks');
				done();
			});
		});
		it('handles edge case of removing at start of dictionary', function(done)
		{
			// paranoid edge case check. dict-end edge case handled above.
			completer.remove('aaaaa', function(err, removed)
			{
				if (err) throw err;
				removed.should.be.ok;
				completer.complete('a', 50, function(err, prefix, completions)
				{
					if (err) throw err;
					completions.length.should.equal(1);
					done();
				});
			});
		});
	});
	describe('#statistics()', function()
	{
		it('calculates storage usage statistics', function(done)
		{
			completer.statistics(function(err, results)
			{
				results.leaves.should.equal(11);
				results.total.should.equal(81);
				results.leaflen.should.equal(125);
				done();
			});
		});
	});
});
