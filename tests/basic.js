let expect = require('chai').expect,
  rimraf = require('rimraf'),
  mkdirp = require('mkdirp'),
  path = require('path'),
  fs = require('fs'),
  async = require('async'),
  zlib = require('zlib'),
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
        let dest_path = path.join(test_dir, 'test.tar');
        let str = pkg.pack().pipe(fs.createWriteStream(dest_path));
        str.on('finish', () => { cb(null, pkg, dest_path) });
      },
      (pkg, tar_path, cb) => {
        pkg.hash((err, hash) => {
          cb(err, hash, tar_path);
        });
      },
      (hash, tar_path, cb) => {
        rimraf.sync(path.join(test_dir, 'a'));
        cb(null, hash, tar_path)
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
    var gzip = zlib.createGzip();
    var gunzip = zlib.createGunzip();

    async.waterfall([
      (cb) => {
        pm.create_package("a", "0.0", cb);
      },
      (pkg0, cb) => {
        pm.create_package("a", "1.0", (err, pkg1) => {

          pkg1.hash((err, hash) => {
            cb(null, pkg0, pkg1, hash);
          });
        });
      },
      (pkg0, pkg1, pkg1_hash, cb) => {
        async.map(
          [ pkg0, pkg1 ],
          (pkg, cb) => {
            let dest_path = path.join(test_dir, 'test_pork_' + pkg.version + '.tar');
            let str = pkg.pack().pipe(fs.createWriteStream(dest_path));
            str.on('finish', () => { cb(null, { package: pkg, packed_tar: dest_path }) });
          },
          (err, results) => {
            let dest_path = path.join(test_dir, 'test_pork.tar.diff');
            pm.diff(
              fs.createReadStream(results[0].packed_tar),
              fs.createReadStream(results[1].packed_tar),
              (err, stream) => {
                let str = stream.pipe(gzip).pipe(fs.createWriteStream(dest_path));
                str.on('finish', () => { cb(null, results[0].packed_tar, dest_path, pkg1_hash); });
              }
            );
          }
        );
      },
      (original_tar, diff, pkg1_hash, cb) => {
        pm.get_package('a').get_version('1.0').remove(() => {

          pm.undiff(
            { hash: pkg1_hash },
            fs.createReadStream(original_tar),
            fs.createReadStream(diff).pipe(gunzip),
            (err, stream) => {
              pm.load_packed_package({ hash: pkg1_hash }, stream, (err, pkg) => {
                expect(pkg.name).to.equal('a');
                expect(pkg.version).to.equal('1.0');
              });
              cb();
            }
          );
          cb();
        });
      }
    ], () => done());
  });

});
