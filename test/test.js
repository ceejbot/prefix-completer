var
	assert = require('chai').assert,
	should = require('chai').should(),
	prefixcompleter = require('../completer'),
	redis = require('redis')
	;

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
		keyprefix: '_completer_test_',
		host: '127.0.0.1'
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
		it('creates a default redis client when no options are passed', function()
		{
			var comp = prefixcompleter.create();
			var rc = comp.client();

			assert.equal(rc.port, 6379);
			assert.equal(rc.host, 'localhost');
		});

		it('obeys the host and port options', function()
		{
			var comp = prefixcompleter.create({
				host: '127.0.0.1',
				port: 6379
			});
			var rc = comp.client();
			assert.equal(rc.port, 6379);
			assert.equal(rc.host, '127.0.0.1');
		});

		it('sets the redis key namespace', function()
		{
			var comp = prefixcompleter.create({ keyprefix: '_test_prefix' });
			var key = comp.rediskey();

			assert.ok(key.indexOf('_test_prefix') > -1, 'redis key prefix option not respected');
		});

		it('connects to the specified database', function(done)
		{
			var comp = prefixcompleter.create({ db: 6 });
			var rc = comp.client();
			rc.ping(function(err, reply)
			{
				should.not.exist(err);
				assert.equal(reply, 'PONG');
				assert.equal(rc.selected_db, 6, 'constructor failed to obey db option');
				done();
			});
		});

		it('uses an existing redis client if one is passed in', function()
		{
			var rc = redis.createClient(6379, '127.0.0.1');
			var comp = prefixcompleter.create({client: rc});
			assert.equal(rc, comp.client());
			assert.equal(6379, comp.client().port);
		});
	});

	describe('#add()', function()
	{
		it('returns the exact string added', function(done)
		{
			var testWord = ' nixy Nox ';
			completer.add(testWord, function(err, added)
			{
				should.not.exist(err);
				added.should.equal('nixy nox');
				done();
			});
		});

		it('doesn\'t add a string that already exists', function(done)
		{
			completer.add('nixy nox', function(err, added)
			{
				should.not.exist(err);
				should.not.exist(added);
				done();
			});
		});

		it('can add very long words', function(done)
		{
			var longword = 'supercalifragilisticexpialidocious';
			completer.add(longword, function(err, added)
			{
				should.not.exist(err);
				added.should.equal(longword);
				done();
			});
		});

		it('can accept array input', function(done)
		{
			completer.add(['one'], function(err, added)
			{
				should.not.exist(err);
				added.should.be.an('array');
				assert.equal(added.length, 1);
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
				should.not.exist(err);
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
				should.not.exist(err);
				completions.length.should.equal(1);
				completions[0].should.equal('nixy nox');
				done();
			});
		});

		it('finds a completion for an exact match', function(done)
		{
			completer.complete(' nixy Nox ', 10, function(err, prefix, completions)
			{
				should.not.exist(err);
				completions.length.should.equal(1);
				completions[0].should.equal('nixy nox');
				done();
			});
		});

		it('returns the trimmed string used for matching', function(done)
		{
			completer.complete('   RESTR', 50, function(err, prefix, completions)
			{
				should.not.exist(err);
				prefix.should.equal('restr');
				done();
			});
		});

		it('returns a list of completions', function(done)
		{
			completer.complete('restr', 50, function(err, prefix, completions)
			{
				should.not.exist(err);
				completions.length.should.equal(3);
				done();
			});
		});

		it('returns at most the requested number of completions', function(done)
		{
			completer.complete('restr', 1, function(err, prefix, completions)
			{
				should.not.exist(err);
				completions.length.should.equal(1);
				done();
			});
		});

		it('returns an empty list when no completions exist', function(done)
		{
			completer.complete('xxxxxx', 1, function(err, prefix, completions)
			{
				should.not.exist(err);
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
				should.not.exist(err);
				removed.should.be.ok;
				done();
			});
		});

		it('removes all prefixes for removed completion', function(done)
		{
			completer.complete('zzz', 50, function(err, prefix, completions)
			{
				should.not.exist(err);
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
				should.not.exist(err);
				completer.remove('aaaab', function(err, removed)
				{
					should.not.exist(err);
					removed.should.be.ok;
					r.zcard(key, function(err, endingSize)
					{
						should.not.exist(err);
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
				should.not.exist(err);
				completions.length.should.equal(1);
				completions[0].should.equal('aaaabbbb');
				done();
			});
		});

		it("doesn't remove unrelated adjacent completions", function(done)
		{
			completer.complete('splatterpunks', 50, function(err, prefix, completions)
			{
				should.not.exist(err);
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
				should.not.exist(err);
				removed.should.be.ok;
				completer.complete('a', 50, function(err, prefix, completions)
				{
					should.not.exist(err);
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
				results.leaves.should.equal(12);
				results.total.should.equal(84);
				results.leaflen.should.equal(128);
				done();
			});
		});
	});
});
