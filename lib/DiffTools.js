var async = require('async'),
    bsdiff = require('bsdiff4'),
    bson = require('bson'),
    streamifier = require('streamifier'),
    toArray = require('stream-to-array');

/// Convert a stream to a buffer
let stream_to_buffer = function(stream, cb) {
  toArray(stream)
    .then(function (parts) {
      var buffers = []
      for (var i = 0, l = parts.length; i < l ; ++i) {
        var part = parts[i]
        buffers.push((part instanceof Buffer) ? part : new Buffer(part))
      }
      cb(null, Buffer.concat(buffers));
    }
  );
}

/// Diff two streams, produce a stream with the diff output.
let diff = function(tar_old_str, tar_new_str, cb) {
  async.map(
    [tar_old_str, tar_new_str],
    (str, cb) => { stream_to_buffer(str, cb) },
    (err, results) => {
      bsdiff.diff(results[0], results[1], (err, control, diff, extra) => {
        let output = {
          l: results[1].length,
          c: control,
          d: diff,
          e: extra
        }
        var BSON = new bson.BSONPure.BSON();
        let serialised = BSON.serialize(output, false, true, false);
        cb(err, streamifier.createReadStream(serialised));
      });
    }
  );
}

/// Undiff two streams, produce a stream with the recombined output.
let undiff = function(tar_str, diff_str, cb) {
  async.map(
    [tar_str, diff_str],
    (str, cb) => { stream_to_buffer(str, cb) },
    (err, results) => {
      var BSON = new bson.BSONPure.BSON();
      var diff_data = BSON.deserialize(results[1]);

      bsdiff.patch(results[0], diff_data.l, diff_data.c, diff_data.d.buffer, diff_data.e.buffer,
        (err, outData) => {
          cb(null, streamifier.createReadStream(outData));
        }
      );
    }
  );
}

module.exports = {
  diff: diff,
  undiff: undiff
}
