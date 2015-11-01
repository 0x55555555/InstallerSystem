var async = require('async'),
    DiffTools = require('./DiffTools'),
    fs = require('fs'),
    hashFiles = require('hash-files'),
    mkdirp = require('mkdirp'),
    mv = require('mv'),
    path = require('path'),
    randomstring = require('randomstring'),
    rimraf = require('rimraf'),
    zlib = require('zlib');

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

        DiffTools.diff(
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

    DiffTools.undiff(
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
    mkdirp(pkg.path, (err) => {
      if (err && err.code != 'EEXIST') { cb(err); }

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

module.exports = Package;
