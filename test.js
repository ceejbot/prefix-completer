/*global describe:true, it:true, beforeEach: true, afterEach:true */

'use strict';
const
	demand          = require('must'),
	prefixcompleter = require('./completer'),
	redis           = require('redis')
	;

const wordlist = [
	'aaaaa',
	'aaaab',
	'aaaabbbb',
	'restrain',
	'restrained',
	'restrainer',
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
	const config = {
		db: 0,
		key: '_completer_test_',
	};
	var completer;

	beforeEach(function(done)
	{
		completer = prefixcompleter.create(config);
		completer.addList(wordlist, function(err, results)
		{
			demand(err).not.exist();
			results.length.must.equal(wordlist.length);
			done();
		});
	});

	afterEach(function()
	{
		completer.flush(function(err, count)
		{
			demand(err).not.exist();
		});
	});

	describe('#create()', function()
	{
		it('creates a default redis client when no options are passed', function()
		{
			var comp = prefixcompleter.create();
			var rc = comp.redis;
			rc.address.must.equal('127.0.0.1:6379');
		});

		it('obeys the redis option', function()
		{
			var comp = prefixcompleter.create({
				redis: 'redis://example.com:5000'
			});
			var rc = comp.redis;
			rc.address.must.equal('example.com:5000');
		});

		it('sets the redis key namespace', function()
		{
			var comp = prefixcompleter.create({ key: '_test_prefix' });
			var key = comp.rediskey;

			key.must.equal('_test_prefix', 'redis key prefix option not respected');
		});

		it('connects to the specified database', function(done)
		{
			var comp = prefixcompleter.create({ db: 6 });
			var rc = comp.redis;
			rc.ping(function(err, reply)
			{
				demand(err).not.exist();
				reply.must.equal('PONG');
				rc.selected_db.must.equal(6, 'constructor failed to obey db option');
				done();
			});
		});

		it('uses an existing redis client if one is passed in', function()
		{
			var rc = redis.createClient(6379, '127.0.0.1');
			var comp = prefixcompleter.create({client: rc});
			comp.redis.must.eql(rc);
		});

		it('returns a promisified object', function()
		{
			var comp = prefixcompleter.create();
			comp.must.have.property('add');
			comp.add.must.be.a.function();
			comp.must.have.property('addAsync');
			comp.addAsync.must.be.a.function();
		});
	});

	describe('#add()', function()
	{
		it('returns the exact string added', function(done)
		{
			var testWord = ' nixy Nox ';
			completer.add(testWord, function(err, added)
			{
				demand(err).not.exist();
				added.must.equal('nixy nox');
				done();
			});
		});

		it('doesn\'t add a string that already exists', function(done)
		{
			completer.add('restrain', function(err, added)
			{
				demand(err).not.exist();
				demand(added).not.exist();
				done();
			});
		});

		it('can add very long words', function(done)
		{
			var longword = 'supercalifragilisticexpialidocious';
			completer.add(longword, function(err, added)
			{
				demand(err).not.exist();
				added.must.equal(longword);
				done();
			});
		});

		it('can accept array input', function(done)
		{
			completer.add(['one1', 'two2'], function(err, added)
			{
				demand(err).not.exist();
				added.must.be.an.array();
				added.length.must.equal(2);
				done();
			});
		});
	});

	describe('#addList()', function()
	{
		it('adds all strings in the passed-in list', function(done)
		{
			var toAdd = ['test', 'this', 'list'];
			completer.addList(toAdd, function(err, results)
			{
				demand(err).not.exist();
				results.length.must.equal(toAdd.length);
				done();
			});
		});
	});

	describe('#complete()', function(done)
	{
		it('gracefully handles empty input', function(done)
		{
			completer.complete('', 10, function(err, prefix, completions)
			{
				demand(err).not.exist();
				prefix.must.equal('');
				completions.must.be.an.array();
				completions.length.must.equal(0);
				done();
			});
		});

		it('gracefully handles non-string input', function(done)
		{
			completer.complete({}, 1, function(err, prefix, completions)
			{
				demand(err).not.exist();
				prefix.must.equal('');
				completions.must.be.an.array();
				completions.length.must.equal(0);
				done();
			});
		});

		it('finds completions', function(done)
		{
			completer.complete('rest', 10, function(err, prefix, completions)
			{
				demand(err).not.exist();
				completions.length.must.equal(4);
				completions[0].must.equal('restrain');
				done();
			});
		});

		it('finds a completion for an exact match', function(done)
		{
			completer.complete('zzzzz', 10, function(err, prefix, completions)
			{
				demand(err).not.exist();
				completions.length.must.equal(1);
				completions[0].must.equal('zzzzz');
				done();
			});
		});

		it('returns the trimmed string used for matching', function(done)
		{
			completer.complete('   RESTR', 50, function(err, prefix, completions)
			{
				demand(err).not.exist();
				prefix.must.equal('restr');
				done();
			});
		});

		it('returns a list of completions', function(done)
		{
			completer.complete('restr', 50, function(err, prefix, completions)
			{
				demand(err).not.exist();
				completions.length.must.equal(4);
				done();
			});
		});

		it('returns at most the requested number of completions', function(done)
		{
			completer.complete('restr', 1, function(err, prefix, completions)
			{
				demand(err).not.exist();
				completions.length.must.equal(1);
				done();
			});
		});

		it('returns an empty list when no completions exist', function(done)
		{
			completer.complete('xxxxxx', 1, function(err, prefix, completions)
			{
				demand(err).not.exist();
				completions.length.must.equal(0);
				done();
			});
		});
	});

	describe('#leaves()', function()
	{
		it('returns an array of leaf nodes', function(done)
		{
			completer.leaves(function(err, leaves)
			{
				demand(err).not.exist();
				leaves.must.be.an.array();
				leaves.length.must.equal(wordlist.length);
				var item = leaves[0];
				item[item.length - 1].must.equal('*');
				leaves.indexOf(wordlist[2] + '*').must.equal(2);
				done();
			});
		});
	});

	describe('#dump()', function()
	{
		it('returns the entire lookup dictionary', function(done)
		{
			completer.dump(function(err, members)
			{
				demand(err).not.exist();
				members.must.be.an.array();
				members.length.must.equal(48);
				done();
			});
		});
	});

	describe('#remove()', function()
	{
		it('does nothing for null input', function(done)
		{
			completer.remove('', function(err, removed)
			{
				demand(err).not.exist();
				removed.must.be.false();
				done();
			});
		});

		it('gracefully ignores non-string input', function(done)
		{
			completer.remove({}, function(err, removed)
			{
				demand(err).not.exist();
				removed.must.be.false();
				done();
			});
		});

		it('removes the specified completion', function(done)
		{
			completer.remove('zzzzz', function(err, removed)
			{
				demand(err).not.exist();
				removed.must.be.true();
				completer.complete('zzz', 50, function(err, prefix, completions)
				{
					demand(err).not.exist();
					completions.length.must.equal(0);
					done();
				});
			});
		});

		it('removes all prefixes for removed completion', function(done)
		{
			completer.remove('zzzzz', function(err, removed)
			{
				demand(err).not.exist();
				removed.must.exist();
				completer.complete('z', 50, function(err, prefix, completions)
				{
					demand(err).not.exist();
					completions.length.must.equal(0);
					done();
				});
			});
		});

		it('declines to remove strings that are not leaves', function(done)
		{
			var key = completer.rediskey;
			var r = completer.redis;

			r.zcard(key, function(err, startingSize)
			{
				demand(err).not.exist();
				completer.remove('restr', function(err, removed)
				{
					demand(err).not.exist();
					removed.must.equal(false);
					r.zcard(key, function(err, endingSize)
					{
						demand(err).not.exist();
						endingSize.must.equal(startingSize);
						done();
					});
				});
			});
		});

		it("doesn't remove prefixes for other completions", function(done)
		{
			var key = completer.rediskey;
			var r = completer.redis;

			r.zcard(key, function(err, startingSize)
			{
				demand(err).not.exist();
				completer.remove('restrained', function(err, removed)
				{
					demand(err).not.exist();
					removed.must.exist();
					r.zcard(key, function(err, endingSize)
					{
						demand(err).not.exist();
						endingSize.must.equal(startingSize - 1);
						completer.complete('restraine', 15, function(err, prefix, completions)
						{
							demand(err).not.exist();
							completions.must.be.an.array();
							completions.length.must.equal(1);
							completions[0].must.equal('restrainer');
							done();
						});
					});
				});
			});
		});

		it('removes completions with non-alphanumerics in them', function(done)
		{
			completer.add(['one1', 'two2'], function(err, added)
			{
				demand(err).not.exist();
				completer.remove('one1', function(err, removed)
				{
					demand(err).not.exist();
					removed.must.exist();
					done();
				});
			});
		});

		it('does nothing when asked to remove a completion that does not exist', function(done)
		{
			var key = completer.rediskey;
			var r = completer.redis;

			r.zcard(key, function(err, startingSize)
			{
				demand(err).not.exist();
				completer.remove('yammer', function(err, removed)
				{
					demand(err).not.exist();
					demand(removed).be.falsy();
					r.zcard(key, function(err, endingSize)
					{
						demand(err).not.exist();
						endingSize.must.equal(startingSize);
						done();
					});
				});
			});
		});

		it('refrains from removing prefixes for matches still in the dictionary, easy case', function(done)
		{
			completer.remove('restrain', function(err, removed)
			{
				demand(err).not.exist();
				removed.must.exist();
				completer.complete('restr', 50, function(err, prefix, completions)
				{
					demand(err).not.exist();
					completions.length.must.equal(3);
					completions[0].must.equal('restrained');
					completions[1].must.equal('restrainer');
					done();
				});
			});
		});

		it('refrains from removing prefixes for matches still in the dictionary, better case', function(done)
		{
			var key = completer.rediskey;
			var r = completer.redis;

			completer.add(['testone', 'testtwo'], function(err, added)
			{
				demand(err).not.exist();
				added.must.be.an.array();
				added.length.must.equal(2);

				r.zcard(key, function(err, startingSize)
				{
					demand(err).not.exist();
					completer.remove('testone', function(err, removed)
					{
						demand(err).not.exist();
						removed.must.exist();

						r.zcard(key, function(err, endingSize)
						{
							demand(err).not.exist();
							endingSize.must.equal(startingSize - 3);
							done();
						});
					});
				});
			});
		});

		it('removes in the boring no-shared-prefix case still', function(done)
		{
			var key = completer.rediskey;
			var r = completer.redis;

			completer.add(['testone', 'testtwo'], function(err, added)
			{
				demand(err).not.exist();
				added.must.be.an.array();
				added.length.must.equal(2);

				r.zcard(key, function(err, startingSize)
				{
					demand(err).not.exist();
					completer.remove('testtwo', function(err, removed)
					{
						demand(err).not.exist();
						removed.must.exist();

						r.zcard(key, function(err, endingSize)
						{
							demand(err).not.exist();
							endingSize.must.equal(startingSize - 3);
							done();
						});
					});
				});
			});
		});

		it("doesn't remove unrelated adjacent completions", function(done)
		{
			completer.complete('splatterpunks', 50, function(err, prefix, completions)
			{
				demand(err).not.exist();
				completions.length.must.equal(1);
				completions[0].must.equal('splatterpunks');
				done();
			});
		});

		it('handles edge case of removing at start of dictionary', function(done)
		{
			completer.remove('aaaaa', function(err, removed)
			{
				demand(err).not.exist();
				removed.must.exist();
				completer.complete('a', 50, function(err, prefix, completions)
				{
					demand(err).not.exist();
					completions.length.must.equal(2);
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
				demand(err).not.exist();
				results.leaves.must.equal(13);
				results.total.must.equal(48);
				results.leaflen.must.equal(108);
				done();
			});
		});
	});
});
