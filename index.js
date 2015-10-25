var assert = require('assert')
  , bsdiff = require('bsdiff')
  , crypto = require('crypto');

var cur = crypto.randomBytes(1024)
  , ref = crypto.randomBytes(1024);

console.log('FUN!');
bsdiff.diff(cur, ref, function(err, ctrl, diff, xtra) {
  console.log('diffed');
  if (err) throw err;
  bsdiff.patch(cur.length, ref, ctrl, diff, xtra, function(err, out) {
    if (err) throw err;
    for (var i = 0; i < cur.length; i++) {
      if (cur[i] !== out[i]) throw 'Patch did not work';
    }
    console.log('Patch worked!');
  });
});
