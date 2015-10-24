var fs = require('fs'),
    mkdirp = require('mkdirp'),
    path = require('path'),
    tar = require('tar-fs'),
    randomstring = require('randomstring');

let try_make_dir = function(path, cb) {
  mkdirp(path, null, (err) => {
    if (err && err.code != 'EEXIST') { console.log("failed to make dir"); }
    cb();
  });
}

let package_info_name = 'package_info.json';
class Package
{
  constructor(containing_folder, name)
  {
    this.name = name;
    this.version = '0.0';
    this.path = path.join(containing_folder, this.name);
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

  set_version(version)
  {
    this.version = version;
  }

  rename(new_name, cb)
  {
    let old_location = this.path;
    this.path = path.join(path.dirname(this.path), new_name);
    this.name = new_name;
    fs.rename(old_location, this.path, (err) => {
      if (err) return cb(err);
      cb();
    });
  }

  pack()
  {
    return tar.pack(this.path)
  }

  static create(containing_folder, name, cb)
  {
    let pkg = new Package(containing_folder, name);
    try_make_dir(pkg.path, () => {
      pkg.save_info((err) => {
        cb(err, pkg);
      });
    });
  }

  static load_packed(containing_folder, stream, cb)
  {
    let pkg = new Package(containing_folder, randomstring.generate())
    let str = stream.pipe(tar.extract(pkg.path));
    str.on('finish', () => {
      pkg.load_info((err, info) => {
        pkg.rename(info.name, () => {
          cb(null, pkg);
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

  create_package(name, cb) {
    return Package.create(this.package_dir, name, cb);
  }

  load_packed_package(stream, cb) {
    return Package.load_packed(this.package_dir, stream, cb);
  }
}

module.exports = function(path) {
  return new Manager(path);
}
