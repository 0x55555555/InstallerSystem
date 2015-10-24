var fs = require('fs'),
    mkdirp = require('mkdirp'),
    mv = require('mv'),
    path = require('path'),
    rimraf = require('rimraf'),
    tar = require('tar-fs'),
    hashFiles = require('hash-files'),
    randomstring = require('randomstring');

let try_make_dir = function(path, cb) {
  mkdirp(path, null, (err) => {
    if (err && err.code != 'EEXIST') { cb(err); }
    cb();
  });
}

let package_info_name = 'package_info.json';
class Package
{
  constructor(containing_folder, name, version)
  {
    this.name = name;
    this.version = version;
    this.container = containing_folder;
    this.path = this.expected_path()
  }

  save_info(cb)
  {
    let obj = {
      name: this.name,
      version: this.version,
    };

    fs.writeFile(
      path.join(this.path, package_info_name),
      JSON.stringify(obj, null, 2),
      (err) => { cb(err); }
    );
  }

  load_info(cb)
  {
    fs.readFile(
      path.join(this.path, package_info_name),
      (err, data) => {
        if (err) return cb(err);
        cb(err, JSON.parse(data));
      }
    );
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
    hashFiles({ files: [ glob ] }, function(error, hash) {
      cb(hash);
    });
  }

  pack()
  {
    return tar.pack(this.path)
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

  static load_packed(containing_folder, hash, stream, cb)
  {
    let pkg = new Package(containing_folder, randomstring.generate(), '0.0')
    let str = stream.pipe(tar.extract(pkg.path));
    str.on('finish', () => {
      pkg.load_info((err, info) => {
        pkg.relocate(info.name, info.version, () => {
          pkg.hash((new_hash) => {
            if (new_hash != hash) {
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

  available_local_packages(cb) {
    fs.readdir(this.package_dir, function(err, files) {
      if (err) {
        return cb(err);
      }
      cb(err, files);
    });
  }

  available_local_versions(pkg, cb) {
    fs.readdir(path.join(this.package_dir, pkg), function(err, files) {
      if (err) {
        return cb(err);
      }
      cb(err, files);
    });
  }

  create_package(name, version, cb) {
    return Package.create(this.package_dir, name, version, cb);
  }

  load_packed_package(hash, stream, cb) {
    return Package.load_packed(this.package_dir, hash, stream, cb);
  }
}

module.exports = function(path) {
  return new Manager(path);
}
