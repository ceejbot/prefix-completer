var completer = require('prefix-completer');
var async = require('async');

// make a dictionary
var tags = completer.create( { prefix: 'tags_', db: 31 } );
console.log("zkey: "+tags.rediskey()); // -> 'completer'

// make a second completion dictionary
var usertags = completer.create( { prefix: 'user_', db: 31 });
console.log("zkey: "+usertags.rediskey()); // -> 'user_completer'

var wordlist = ['supernumary', ' superb ', 'Super', 'mary poppins', 'bert the sweep', 'codfish', 'sugar'];

async.series(
[
	function(cb) { tags.flush(cb) }, // clear for the example
	function(cb) { tags.add('supercalifragilisticexpialidocious', cb) }, // add a single word
	function(cb) { tags.addList(wordlist, cb) }, // add a list of words
	function(cb) { tags.complete('supe', 15, cb) }, // get completions for a prefix
	function(cb) { usertags.complete('supe', 15, cb) } // get completions from another dictionary
],
function(err, results)
{
	console.log("added 1 completion to dict: "+results[1]);
	console.log('added '+results[2].length+" completions to dict");
	console.log("found "+results[3][1].length+" completions for '"+results[3][0]+"':");
	console.log(results[3][1]);
	console.log("the user tags dictionary has "+results[4][1].length+" completions for 'supe'");
	process.exit(0);
});
