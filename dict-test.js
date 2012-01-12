// Stick /usr/dict/words into the dictionary and see what we end up with.

var auto = require('prefix-completer');
var redis = require('redis');
var fs = require('fs');
var lazy = require('lazy');
var async = require('async');

var config = {
	host: 'thusia.local',
	db: 30,
	prefix: '_sizetest_'
};

var completer = auto.create(config);
var r = completer.client();

function populateFromDict(callback)
{
	var counter = 0;
	var dict = fs.createReadStream('/usr/share/dict/web2');
	new lazy(dict)
		.lines
		.map(String)
		.forEach(function(line)
		{
			completer.add(line, function(err, added)
			{
				counter++;
				if ((counter % 2000) == 0) console.log(counter+": "+added);
				// a hack to know when we're done.
				if (added == 'zyzzogeton')
				{
					console.log(added + '-- DONE');
					callback();
				}
			});
		});
};

function newTests(callback)
{
	completer.flush(function() 
	{
		populateFromDict(function()
		{
			var result = completer.stats();
			console.log("in-memory counters: "+result);
			callback();
		});
	});
}

function getCounts()
{
	console.log("redis counts are:");
	async.series(
	[
		function(cb) { r.get(completer.zkey+'_leaf_count', cb) },
		function(cb) { r.get(completer.zkey+'_leaf_strlen', cb) },
		function(cb) { r.get(completer.zkey+'_prefix_strlen', cb) },
		function(cb) { r.zcard(completer.zkey, cb) }
	],
	function(err, results)
	{
		console.log("     leaf count: "+results[0]);
		console.log("  leaf strs len: "+results[1]);
		console.log("prefix strs len: "+results[2]);
		console.log("          zcard: "+results[3]);
		var end = new Date().getTime()/1000;
		console.log("   elapsed time: "+(end-start)+" sec");
		process.exit(0);
	});

}

var start = new Date().getTime()/1000;
newTests(getCounts);
//getCounts();
