var gulp = require("gulp");
var mocha = require('gulp-mocha');
var babel = require('babel/register');

gulp.task('test', function() {
  return gulp.src('tests/*.js', {read: false})
      // gulp-mocha needs filepaths so you can't have any plugins before it
      .pipe(mocha({
        compilers: {
            js: babel
        }
      }));
});

gulp.task("watch_test", function(){
    gulp.watch('**/*.js', ['test']);
});
