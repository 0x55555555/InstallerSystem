var async = require('async'),
    fs = require('fs'),
    mkdirp = require('mkdirp'),
    Package = require('./Package'),
    path = require('path'),
    temp = require('temp'),
    VersionManager = require('./VersionManager');

/// Manage of multiple packages, and their versions
class PackageManager
{
  /// Create a new manager, callback when fully setup
  constructor(dir)
  {
    this.package_dir = dir
    mkdirp.sync(this.package_dir, null, (err) => {
      if (err && err.code != 'EEXIST') { return cb(err); }
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
  return new PackageManager(path);
}
