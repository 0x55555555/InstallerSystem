let expect = require('chai').expect,
  rimraf = require('rimraf'),
  mkdirp = require('mkdirp'),
  mv = require('mv'),
  path = require('path'),
  fs = require('fs'),
  async = require('async'),
  zlib = require('zlib'),
  PackageManager = require('../lib/git loPackageManager')

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

    var pkg = pm.create_package("test", "0.0", (err, pkg) => {

      expect(pkg.path).to.equal(path.join(test_dir, 'test', '0.0'));

      let stats = fs.lstatSync(pkg.path);
      expect(stats.isDirectory()).to.equal(true);


      async.series([
        (cb) => {
          pkg.hash((err, hash) => {
            expect(hash).to.equal("44eb56140193ae961eab22683e9e48c10b306e3f");
            cb();
          });
        },
        (cb) => {
          let info = pkg.load_info((err, info) => {
            expect(info.name).to.equal('test');
            expect(info.version).to.equal('0.0');
            cb();
          });
        }
      ], () => done()
      );
    });
  });

  it('lists packages', function(done) {
    let test_dir = make_test_dir('lists_packages');
    let pm = PackageManager(test_dir);

    async.series([
      (cb) => {
        pm.create_package("a", "0.0", cb);
      },
      (cb) => {
        pm.create_package("c", "1.0", cb);
      },
      (cb) => {
        pm.create_package("b", "0.0", cb);
      },
      (cb) => {
        pm.create_package("b", "0.1", cb);
      },
      (cb) => {
        pm.create_package("b", "0.2", cb);
      }
    ], (err, results) => {
      async.parallel([
        (cb) => {
          pm.installed_packages((err, pkgs) => {
            expect(pkgs.length).to.eql(3);
            expect(pkgs[0].name).to.eql('a');
            expect(pkgs[1].name).to.eql('b');
            expect(pkgs[2].name).to.eql('c');
            cb();
          });
        },
        (cb) => {
          let a_pkgs = pm.get_package('a');
          a_pkgs.installed_versions((err, pkgs) => {
            expect(pkgs.length).to.eql(1);
            expect(pkgs[0].name).to.eql('a');
            expect(pkgs[0].version).to.eql('0.0');
            cb();
          });
        },
        (cb) => {
          let c_pkgs = pm.get_package('c');
          c_pkgs.installed_versions((err, pkgs) => {
            expect(pkgs.length).to.eql(1);
            expect(pkgs[0].name).to.eql('c');
            expect(pkgs[0].version).to.eql('1.0');
            cb();
          });
        },
        (cb) => {
          let b_pkgs = pm.get_package('b');
          b_pkgs.installed_versions((err, pkgs) => {
            expect(pkgs.length).to.eql(3);
            expect(pkgs[0].name).to.eql('b');
            expect(pkgs[0].version).to.eql('0.0');
            expect(pkgs[1].name).to.eql('b');
            expect(pkgs[1].version).to.eql('0.1');
            expect(pkgs[2].name).to.eql('b');
            expect(pkgs[2].version).to.eql('0.2');
            cb();
          });
        }
      ],
      () => {
        done();
      });
    });
  });

  it('pack packages', function(done) {
    let test_dir = make_test_dir('pack_packages');
    let pm = PackageManager(test_dir);

    async.waterfall([
      (cb) => {
        pm.create_package("a", "0.0", cb);
      },
      (pkg, cb) => {
        pkg.has_packed((err, has) => {
          expect(has).to.equal(false);
          pkg.pack({}, (err, hash, path) => {

            pkg.has_packed((err, has) => {
              expect(has).to.equal(true);
              cb(null, pkg, hash, path);
            });
          });
        });
      },
      (pkg, hash, packed_path, cb) => {
        let dest_path = path.join(test_dir, 'test.pkg');
        mv(packed_path, dest_path, () => {
          rimraf.sync(path.join(test_dir, 'a'));
          cb(null, hash, dest_path)
        });
      },
      (hash, path, cb) => {
        pm.load_packed_package({ hash: hash }, fs.createReadStream(path), (err, pkg) => {
          pkg.load_info((err, info) => {
            expect(info.name).to.equal('a');
            expect(info.version).to.equal('0.0');

            cb();
          });
        })
      }
    ], () => done());
  });

  it('installer packs', function(done) {
    let test_dir = make_test_dir('installer_packs');
    let pm = PackageManager(test_dir);

    async.series([
      (cb) => {
        pm.create_package("a", "0.0", cb);
      },
      (cb) => {
        pm.create_package("c", "1.0", cb);
      },
      (cb) => {
        pm.create_package("b", "0.0", cb);
      }
    ], (err, pkgs) => {
      let found_pkgs = [
        pm.get_package('a').get_version('0.0'),
        pm.get_package('b').get_version('0.0'),
        pm.get_package('c').get_version('1.0')
      ];

      let out_path = path.join(test_dir, 'out.tar');
      pm.combine("combined", '0.0', found_pkgs, (err, pkg) => {
        done();
      });
    });
  });

  it('load diff packages', function(done) {
    let test_dir = make_test_dir('load_diff_packages');
    let pm = PackageManager(test_dir);

    async.waterfall([
      // Create package a v0.0
      (cb) => {
        pm.create_package("a", "0.0", cb);
      },
      // Create package a v1.0
      (pkg0, cb) => {
        pm.create_package("a", "1.0", (err, pkg1) => {
          // Pass on packages and hash
          pkg1.hash((err, hash) => {
            cb(null, pkg0, pkg1, hash);
          });
        });
      },
      // Pack package 0 with no deltas
      (pkg0, pkg1, pkg1_hash, cb) => {
        pkg0.pack({}, (err, hash, path) => {
          cb(null, pkg0, pkg1);
        });
      },
      // Pack package 1 with delta to 0
      (pkg0, pkg1, cb) => {
        pkg1.pack({ deltas: [ pkg0 ]},
          (err, hash, path, deltas) => {
            cb(null, pkg0, deltas[0].path, hash);
          }
        );
      },
      // now remove the old 1.0 package and regenerate from delta
      (pkg0, diff, pkg1_hash, cb) => {
        pm.get_package('a').get_version('1.0').remove(() => {
          // undiff generates a new package from [pkg0] from a delta.
          pkg0.undiff(
            { hash: pkg1_hash },
            diff,
            (err, pkg) => {
              // pkg is the unpacked package, added to pm
              expect(pkg.name).to.equal('a');
              expect(pkg.version).to.equal('1.0');
              cb();
            });
        });
      }
    ], () => done());
  });
});
