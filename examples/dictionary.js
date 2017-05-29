// Stick /usr/dict/words into the dictionary and see what we end up with.

const auto = require('prefix-completer');
const fs = require('fs');
const Lazy = require('lazy');

const config = {
	db: 30,
	keyprefix: '_sizetest_'
};

function populateFromDict(callback)
{
	var counter = 0;
	const dict = fs.createReadStream('/usr/share/dict/web2');
	new Lazy(dict)
		.lines
		.map(String)
		.forEach(function(line)
		{
			completer.add(line, function(err, added)
			{
				if (err) return callback(err);
				counter++;
				if ((counter % 2000) === 0) console.log(counter + ': ' + added);
				// a hack to know when we're done.
				if (added === 'zyzzogeton')
				{
					console.log(added + '-- DONE');
					callback();
				}
			});
		});
}

function newTests(callback)
{
	completer.flush(function()
	{
		populateFromDict(callback);
	});
}

function getCounts()
{
	console.log('redis counts are:');
	completer.statistics(function(err, results)
	{
		if (err) throw err;
		console.log(results);
		completer.flush(process.exit(0));
	});
}

var completer = auto.create(config);
newTests(getCounts);
//getCounts();
