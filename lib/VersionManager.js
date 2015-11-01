let async = require('async'),
    fs = require('fs'),
    Package = require('./Package'),
    path = require('path');

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

module.exports = VersionManager;
