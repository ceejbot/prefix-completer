## Simple Prefix Completer

A simple prefix completion library for Node.js & Redis. Stores texts & their prefixes in redis according to the algorithm given by [antirez](https://github.com/antirez) [in this gist](https://gist.github.com/574044). The only scoring used is lexical sorting. No additional data is stored along with the texts. 

The use case it was developed for is tag auto-completion, for which I needed no fancy datastructures or scoring approaches. It's inefficient with space in exchange for lookup speed.

## Installation

Clone the git repo and link it with `npm`. Or install the module:

`npm install prefix-completer`

## Usage

```javascript
var completer = require('prefix-completer');
var tags = completer.create( { db: 31 } );
console.log("zkey: "+tags.rediskey()); // -> 'completer'

tags.flush(function(err, okay) 
{
	tags.add('supercalifragilisticexpialidocious', function(err, added)
	{
		console.log('added '+added);
		var wordlist = ['mary poppins', 'bert the sweep', 'codfish', 'sugar'];
		tags.addList(wordlist, function(err, added)
		{
			console.log('added '+added.length+" completions ");
			tags.complete('cod', 15, function(err, prefix, results) {
				console.log(results);
			});
		});
	});
	
	var usertags = completer.create( { prefix: 'user_', db: 31 });
	console.log("zkey: "+usertags.rediskey()); // -> 'user_completer'
	usertags.complete('cod', 15, function(err, prefix, results) {
		console.log("user_ dictionary gave us: "+results); // results will be empty!
	});
});	
```

## API

### create()

`create([options])`

Create a completion dictionary. Synchronous. Takes optional hash of parameters. Valid parameters:

host
: string specifying redis host (defaults to localhost)

port
: integer specifying redis port (defaults to 6379)

db
: integer specifying the redis database to select (defaults to 0)

prefix
: a short string prefix for the redis sorted set key; used to namespace lookup dictionaries

client
: an existing RedisClient


### add()

`add(completion, callback(err, added))`

Add a string to the completion dictionary. Responds with the exact string added. Leading & trailing space are removed and the string is converted to lowercase. If the string was already present, responds with null.

### addList()

`add(stringlist, callback(err, addedlist))`

Add an array of strings to the completion dictionary. Responds with an array of the exact strings added. Skips strings that were already present.

### complete()

`complete(prefix, maxresults, callback(err, prefixcleaned, completions))`

Search for completions for the passed-in search string. Responds with the exact string searched for and an array of completions containing at most *maxresults* strings.

### remove()

`remove(completion, callback(err, removed))`

Removes the specified completion from the dictionary. Responds with true if successful.

### flush()

`flush(callback(err, count))`

Delete the key used to store this dictionary set. Passes the callback straight through to the redis DEL call, which responds with the number of keys deleted.

