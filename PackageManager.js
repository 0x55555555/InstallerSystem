var fs = require('fs'),
    mkdirp = require('mkdirp'),
    mv = require('mv'),
    path = require('path'),
    rimraf = require('rimraf'),
    tar = require('tar-fs'),
    async = require('async'),
    hashFiles = require('hash-files'),
    randomstring = require('randomstring'),
    bsdiff = require('bsdiff4'),
    temp = require('temp'),
    toArray = require('stream-to-array'),
    bson = require('bson'),
    streamifier = require('streamifier');

let try_make_dir = function(path, cb) {
  mkdirp(path, null, (err) => {
    if (err && err.code != 'EEXIST') { cb(err); }
    cb();
  });
}

let stream_to_buffer = function(stream, cb) {
  toArray(stream)
    .then(function (parts) {
      var buffers = []
      for (var i = 0, l = parts.length; i < l ; ++i) {
        var part = parts[i]
        buffers.push((part instanceof Buffer) ? part : new Buffer(part))
      }
      cb(null, Buffer.concat(buffers));
    })
}

let package_info_name = 'package_info.json';
class Package
{
  constructor(containing_folder, name, version) {
    this.name = name;
    this.version = version;
    this.container = containing_folder;
    this.path = this.expected_path();
    this.extra_keys = { };
  }

  save_info(cb) {
    let obj = {
      name: this.name,
      version: this.version
    };

    for (var key in this.extra_keys) {
      obj[key] = this.extra_keys[key];
    }

    fs.writeFile(
      path.join(this.path, package_info_name),
      JSON.stringify(obj, null, 2),
      (err) => { cb(err); }
    );
  }

  load_info(cb) {
    fs.readFile(
      path.join(this.path, package_info_name),
      (err, data) => {
        if (err) return cb(err);
        cb(err, JSON.parse(data));
      }
    );
  }

  set(key, value) {
    this.extra_keys[key] = value;
  }

  relocate(name, version, cb)
  {
    let old_location = this.path;
    this.name = name;
    this.version = version;
    this.path = this.expected_path();
    mv(old_location, this.path, { mkdirp: true }, (err) => {
      if (err) { return cb(err); }
      rimraf(path.dirname(old_location), (err) => {
        if (err) { return cb(err); }

        cb();
      });
    });
  }

  hash(cb) {
    let glob = path.join(this.path, '**');
    hashFiles({ files: [ glob ] }, function(err, hash) {
      cb(err, hash);
    });
  }

  pack()
  {
    return require('tar-fs').pack(this.path)
  }

  expected_path()
  {
    return path.join(this.container, this.name, this.version);
  }

  static create(containing_folder, name, version, cb)
  {
    let pkg = new Package(containing_folder, name, version);
    try_make_dir(pkg.path, () => {
      pkg.save_info((err) => {
        cb(err, pkg);
      });
    });
  }

  static load_packed(containing_folder, options, stream, cb)
  {
    let pkg = new Package(containing_folder, randomstring.generate(), '0.0');
    let str = stream.pipe(require('tar-fs').extract(pkg.path));
    str.on('finish', () => {
      pkg.load_info((err, info) => {
        pkg.relocate(info.name, info.version, () => {
          pkg.hash((err, new_hash) => {
            if (options.hash && new_hash != options.hash) {
              return cb({
                expected_hash: hash,
                real_hash: new_hash
              });
            }
            cb(null, pkg);
          });
        });
      });
    });
  }
}

class VersionManager
{
  constructor(dir, name) {
    this.package_dir = dir;
    this.name = name;
  }

  get_version(version) {
    return Package(this.package_dir, this.name, version);
  }

  installed_versions(cb) {
    let that = this;
    fs.readdir(path.join(this.package_dir, this.name), function(err, versions) {
      if (err) {
        return cb(err);
      }

      async.filter(
        versions,
        (version, cb) => {
          fs.lstat(path.join(that.package_dir, that.name, version), (err, stats) => {
            console.log("pork", path.join(that.package_dir, that.name, version), stats.isDirectory())
            cb(null, stats.isDirectory());
          });
        },
        (err, versions) => {
          console.log("got", err, versions);
          async.map(
            versions,
            (version, cb) => {
              cb(err, new Package(that.package_dir, that.name, version));
            },
            (err, pkgs) => {
              cb(err, pkgs);
            }
          );
        });
    });
  }
}

class Manager
{
  constructor(dir, cb)
  {
    this.package_dir = dir
    mkdirp.sync(this.package_dir, null, (err) => {
      if (err && err.code != 'EEXIST') { return cb(err); }
      cb();
    });
  }

  installed_packages(cb) {
    let that = this;
    fs.readdir(this.package_dir, function(err, files) {
      if (err) {
        return cb(err);
      }

      async.map(
        files,
        (file, cb) => {
          cb(null, new VersionManager(that.package_dir, file));
        },
        cb
      );
    });
  }

  combine(name, version, pkgs, cb) {
    this.create_package(name, version, (err, packed_pkg) => {
      async.map(
        pkgs,
        (pkg, cb) => {
          let pkg_path = path.join(packed_pkg.path, pkg.name + '_' + pkg.version + '.tar');
          let str = pkg.pack().pipe(fs.createWriteStream(pkg_path));
          str.on('finish', () => {
            pkg.hash((err, hash) => {
              cb(null, { file: pkg_path, hash: hash });
            });
          });
        },
        (err, results) => {
          packed_pkg.set('sub_packages', results);
          packed_pkg.save_info((err) => {
            cb(err, packed_pkg);
          });
        }
      );
    });
  }

  diff(tar_old_str, tar_new_str, cb) {
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

  undiff(options, tar_old_str, tar_diff_str, cb) {
    async.map(
      [tar_old_str, tar_diff_str],
      (str, cb) => { stream_to_buffer(str, cb) },
      (err, results) => {
        var BSON = new bson.BSONPure.BSON();
        var diff_data = BSON.deserialize(results[1]);

        bsdiff.patch(results[0], diff_data.l, diff_data.c, diff_data.d.buffer, diff_data.e.buffer,
          (err, outData) => {
            cb(err, streamifier.createReadStream(outData));
          }
        );
      }
    );
  }

  create_package(name, version, cb) {
    return Package.create(this.package_dir, name, version, cb);
  }

  remove_package(name, version, cb) {
    let pkg = this.get_package(name, version);

    rimraf(pkg.path, cb);
  }

  load_packed_package(options, stream, cb) {
    return Package.load_packed(this.package_dir, options, stream, cb);
  }

  get_package(name) {
    return new VersionManager(this.package_dir, name)
  }
}

module.exports = function(path) {
  return new Manager(path);
}
