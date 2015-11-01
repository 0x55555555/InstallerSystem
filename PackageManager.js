var fs = require('fs'),
    mkdirp = require('mkdirp'),
    mv = require('mv'),
    path = require('path'),
    rimraf = require('rimraf'),
    tar = require('tar-fs'),
    zlib = require('zlib'),
    async = require('async'),
    hashFiles = require('hash-files'),
    randomstring = require('randomstring'),
    bsdiff = require('bsdiff4'),
    temp = require('temp'),
    toArray = require('stream-to-array'),
    bson = require('bson'),
    streamifier = require('streamifier');

/// Try to make a dir, ignore if already existing
let try_make_dir = function(path, cb) {
  mkdirp(path, null, (err) => {
    if (err && err.code != 'EEXIST') { cb(err); }
    cb();
  });
}

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
    })
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

let package_info_name = 'package_info.json';

/// Package is a single instance of a package,
class Package
{
  /// Create a new package
  /// \note Doesn't write anything to disk
  constructor(containing_folder, name, version) {
    this.name = name;
    this.version = version;
    this.container = containing_folder;
    this.path = this.expected_path();
    this.extra_keys = { };
  }

  /// Write all package info to json in package folder
  /// \expects package dir to exist.
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

  /// Load package info from disk
  /// \note doesn't change internal settings, but returns them to user
  load_info(cb) {
    fs.readFile(
      path.join(this.path, package_info_name),
      (err, data) => {
        if (err) return cb(err);
        cb(err, JSON.parse(data));
      }
    );
  }

  /// Delete this package
  /// \note Leaves package version folder
  remove(cb) {
    rimraf(this.path, cb);
  }

  /// Set a key and value in the package data
  set(key, value) {
    this.extra_keys[key] = value;
  }

  /// Move a package from its current location to [name], and [version]
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

  /// Generate a hash for this package's disk contents
  /// Used to verify the package is the same at its destination
  hash(cb)
  {
    let glob = path.join(this.path, '**');
    hashFiles({ files: [ glob ] }, function(err, hash) {
      cb(err, hash);
    });
  }

  /// Find the location the package should be at when packed
  packed_path()
  {
    return path.join(this.container, this.name, this.version + ".pkg");
  }

  /// Find the name for the diff-package which is generated from [from_pkg]
  packed_diff_path(from_pkg)
  {
    return path.join(this.container, this.name, from_pkg.version + "_" + this.version + ".pkg.diff");
  }

  /// Find if a packed version of the package exists at the expected location
  has_packed(cb)
  {
    fs.exists(this.packed_path(), (has) => {
      cb(null, has);
    });
  }

  /// Pack this package into the [expected_pack()]
  /// Also, if opts contains a [deltas] array of other packages
  /// generate delta packages against them too.
  pack(opts, cb)
  {
    this.hash((err, hash) => {
      let packed = require('tar-fs').pack(this.path).pipe(zlib.createGzip());
      let str = packed.pipe(fs.createWriteStream(this.packed_path()));
      str.on('finish', () => {
        if (opts.deltas) {
          async.map(
            opts.deltas,
            (pkg, cb) => {
              this.diff(pkg, (err, path) => {
                cb(err, { source: pkg, dest: this, path: path });
              });
            },
            (err, results) => {
              cb(null, hash, this.packed_path(), results);
            });
        }
        else {
          cb(null, hash, this.packed_path())
        }
      });
    });
  }

  /// Diff this package against [other_pkg]'s packed contents'
  diff(other_pkg, cb)
  {
    let diff_path = this.packed_diff_path(other_pkg);

    async.map(
      [other_pkg.expected_path(), this.expected_path()],
      (pth, cb) => { fs.exists(pth, (t) => cb(null, t) ) },
      (err, results) => {
        for (var r in results) {
          if (!results[r]) {
            return cb("Source package missing");
          }
        }

        diff(
          fs.createReadStream(other_pkg.packed_path()).pipe(zlib.createGunzip()),
          fs.createReadStream(this.packed_path()).pipe(zlib.createGunzip()),
          (err, diff_stream) => {
            let str = diff_stream.pipe(zlib.createGzip()).pipe(fs.createWriteStream(diff_path));

            str.on('finish', () => {
              cb(null, diff_path);
            });
          }
        );
      }
    );
  }

  /// Unpack a package using this package as a source
  /// and [delta] as a diff package.
  /// If opts contains a hash, use this to verify the package contents
  undiff(opts, delta, cb)
  {
    let packed_reader = fs.createReadStream(this.packed_path()).pipe(zlib.createGunzip());
    let unpacked_delta = fs.createReadStream(delta).pipe(zlib.createGunzip());

    undiff(
      packed_reader,
      unpacked_delta,
      (err, pkg_stream) => {
        Package.load_packed_uncompressed(
          this.container,
          { hash: opts.hash },
          pkg_stream,
          cb
        );
      }
    );
  }

  /// Find the expected location for the unpacked package
  expected_path()
  {
    return path.join(this.container, this.name, this.version);
  }

  /// Create a new package on disk
  static create(containing_folder, name, version, cb)
  {
    let pkg = new Package(containing_folder, name, version);
    try_make_dir(pkg.path, () => {
      pkg.save_info((err) => {
        cb(err, pkg);
      });
    });
  }

  /// Unpack a new package from packed version
  static load_packed(containing_folder, options, stream, cb)
  {
    this.load_packed_uncompressed(containing_folder, options, stream.pipe(zlib.createGunzip()), cb);
  }

    /// Unpack a new (uncompressed) package from packed version
  static load_packed_uncompressed(containing_folder, options, stream, cb)
  {
    let pkg = new Package(containing_folder, randomstring.generate(), '0.0');
    mkdirp(pkg.path, null, (err) => {
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
    });
  }
}

/// Manage multiple versions of a single package
class VersionManager
{
  constructor(dir, name) {
    this.package_dir = dir;
    this.name = name;
  }

  /// Get the package [version]
  get_version(version) {
    return new Package(this.package_dir, this.name, version);
  }

  /// Find the installed (unpacked) versions of this package
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
            cb(stats.isDirectory());
          });
        },
        (versions) => {
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

/// Manage of multiple packages, and their versions
class Manager
{
  /// Create a new manager, callback when fully setup
  constructor(dir, cb)
  {
    this.package_dir = dir
    mkdirp.sync(this.package_dir, null, (err) => {
      if (err && err.code != 'EEXIST') { return cb(err); }
      cb();
    });
  }

  /// Find all installed packages (VersionManagers for each package)
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

  /// Combine many packages into a single new package
  combine(name, version, pkgs, cb) {
    this.create_package(name, version, (err, packed_pkg) => {
      async.map(
        pkgs,
        (pkg, cb) => {
          let pkg_path = path.join(packed_pkg.path, pkg.name + '_' + pkg.version + '.tar');
          pkg.pack({}, (err, hash, pkg_path) => {
            // copy into the master directory
            let pipe = fs.createReadStream(pkg_path).pipe(fs.createWriteStream(pkg_path));
            pipe.on('finish', () => {
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

  /// Create a new package
  create_package(name, version, cb) {
    return Package.create(this.package_dir, name, version, cb);
  }

  /// Load a packed package
  load_packed_package(options, stream, cb) {
    return Package.load_packed(this.package_dir, options, stream, cb);
  }

  /// Find a version manager for [name]
  get_package(name) {
    return new VersionManager(this.package_dir, name)
  }
}

module.exports = function(path) {
  return new Manager(path);
}
