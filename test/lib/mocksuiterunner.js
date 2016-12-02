var path = require('path');
var fs = require('fs');
var mockery = require('mockery');
var common = require('../common.js');

/**
 * Allows for a Runner run to load a passed in object or array of objects
 * to be used in place of a test suite or collection of test suite files.
 * This uses mockery and expects it to be enabled when starting a run.
 */
function MockedSuiteRunner (suites, opts, addOpts, completeHandler) {
  this.suites = suites;
  this.opts = opts;
  this.addOpts = addOpts;
  this.completeHandler = completeHandler;
}

/**
 * Starts a test run. Unlike Runner.run, a promise is not returned. Instead
 * A done callback is supplied which calls done with no value on Runner.run
 * promise resolve and with an error value on promise reject.
 */
MockedSuiteRunner.prototype.run = function (done) {
  var testOpts = {
    seleniumPort: 10195,
    silent: true,
    output: false
  };

  for (var opt in this.opts) {
    testOpts[opt] = this.opts[opt];
  }

  var testAddOpts = {
    output_folder: false,
    start_session: true
  };

  for (var addOpt in this.addOpts) {
    testAddOpts[addOpt] = this.addOpts[addOpt];
  }

  var suites = this.suites;
  if (!Array.isArray(this.suites)) {
    suites = [suites];
  }

  var completeHandler = this.completeHandler;

  var testPaths = createMocks(suites);
  console.log(testPaths)
  var Runner = common.require('runner/run.js');

  var runner = new Runner(testPaths, testOpts, testAddOpts, function doneCb() {
    testPaths.forEach(mockery.deregisterMock);
    if (completeHandler) {
      completeHandler.apply(this, arguments);
    }
  })
  
  runner.run()
    .then(function () {
      done();
    }, function (err) {
      done(err);
    });
};

var suiteCounter = 0;

/**
 * Creates mock test suite files and patches fs to recognize those
 * files as files.
 */
function createMocks (suites) {
  var testPaths = suites.map(function (suite) {
    var testPath = path.join(__dirname, 'MockedSuite_' + (suiteCounter++) + '.js');
    mockery.registerMock(testPath.slice(0, -3), suite);
    return testPath;
  });

  var mockFs = Object.create(fs);
  mockFs.stat = function (filePath, callback) {
    if (testPaths.indexOf(filePath) >= 0) {
      callback(null, {
        isFile: function () { return true; },
        isDirectory: function () { return false; }
      });
      return;
    }
    return fs.stat.apply(fs, arguments);
  };

  mockery.registerMock('fs', mockFs);

  return testPaths;
}

module.exports = MockedSuiteRunner;