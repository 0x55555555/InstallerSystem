let expect = require('chai').expect,
  rimraf = require('rimraf'),
  mkdirp = require('mkdirp'),
  path = require('path'),
  fs = require('fs'),
  async = require('async'),
  PackageManager = require('../PackageManager')

let to_test_data_dir = path.join('tests', 'data');
let make_test_dir = function(name, cb) {
  let dir = path.join(to_test_data_dir, name);
  rimraf.sync(dir);
  return dir;
}

describe('package_manager', function() {
  it('creates packages', function(done) {
    let test_dir = make_test_dir('creates_packages');
    let pm = PackageManager(test_dir);

    var pkg = pm.create_package("test", (err, pkg) => {

      let info = pkg.load_info((err, info) => {
        expect(info.name).to.equal('test');
        expect(info.version).to.equal('0.0');

        done();
      });
    });
  });

  it('lists packages', function(done) {
    let test_dir = make_test_dir('lists_packages');
    let pm = PackageManager(test_dir);

    async.series([
      (cb) => {
        pm.create_package("a", cb);
      },
      (cb) => {
        pm.create_package("b", cb);
      }
    ], (err, results) => {
      pm.available_local_packages((err, pkgs) => {
        expect(pkgs.length).to.equal(2);
        done();
      });
    });
  });

  it('pack packages', function(done) {
    let test_dir = make_test_dir('pack_packages');
    let pm = PackageManager(test_dir);

    async.waterfall([
      (cb) => {
        pm.create_package("a", cb);
      },
      (pkg, cb) => {
        let dest_path = path.join(test_dir, 'my-tarball.tar');
        let str = pkg.pack().pipe(fs.createWriteStream(dest_path));
        str.on('finish', () => { cb(null, pkg, dest_path) });
      },
      (pkg, path, cb) => {
        rimraf.sync(pkg.path);
        cb(null, path)
      },
      (path, cb) => {
        pm.load_packed_package(fs.createReadStream(path), (err, pkg) => {
          pkg.load_info((err, info) => {
            expect(info.name).to.equal('a');
            expect(info.version).to.equal('0.0');
            cb();
          });
        })
      }
    ], () => done());
  });

});
