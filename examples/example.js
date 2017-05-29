#!/usr/bin/env node

const
	completer = require('prefix-completer'),
	async = require('async')
	;

// make a dictionary
const tags = completer.create({ key: 'tagss', db: 31 });
console.log('zkey: ' + tags.rediskey()); // -> 'tags'

// make a second completion dictionary
const usertags = completer.create({ key: 'users', db: 31 });
console.log('zkey: ' + usertags.rediskey()); // -> 'users'

const wordlist = ['supernumary', ' superb ', 'Super', 'mary poppins', 'bert the sweep', 'codfish', 'sugar'];

async.series([
	function(cb) { tags.flush(cb); }, // clear for the example
	function(cb) { tags.add('supercalifragilisticexpialidocious', cb); }, // add a single word
	function(cb) { tags.addList(wordlist, cb); }, // add a list of words
	function(cb) { tags.complete('supe', 15, cb); }, // get completions for a prefix
	function(cb) { usertags.complete('supe', 15, cb); } // get completions from another dictionary
],
function(err, results)
{
	if (err) throw err;
	console.log('added 1 completion to dict: ' + results[1]);
	console.log('added ' + results[2].length + ' completions to dict');
	console.log('found ' + results[3][1].length + ' completions for "' + results[3][0] + '":');
	console.log(results[3][1]);
	console.log('the user tags dictionary has ' + results[4][1].length + ' completions for "supe"');
	process.exit(0);
});
