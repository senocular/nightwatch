var path = require('path');
var fs = require('fs');
var assert = require('assert');
var mockery = require('mockery');
var common = require('../../common.js');
var CommandGlobals = require('../../lib/globals/commands.js');

module.exports = {
  'error handling': {
    before: function (done) {
      CommandGlobals.beforeEach.call(this, done);
    },

    after: function (done) {
      CommandGlobals.afterEach.call(this, done);
    },

    beforeEach: function () {
      process.removeAllListeners('exit');
      process.removeAllListeners('uncaughtException');

      mockery.enable({
        useCleanCache: true,
        warnOnReplace: false,
        warnOnUnregistered: false
      });
    },

    afterEach: function () {
      mockery.disable();
    },

    'global.afterEach run when global.beforeEach throws': !function (done) {
      var beforeEachReached = false;
      var afterEachReached = false;
      var unexpectedReached = false;
      function unexpected () {
        unexpectedReached = true;
      }
      var globals = {
        beforeEach: function () {
          beforeEachReached = true;
          throw new Error('beforeEach');
        },
        afterEach: function () {
          afterEachReached = true;
        }
      };
      var testSuite = {
        before: unexpected,
        beforeEach: unexpected,
        afterEach: unexpected,
        after: unexpected,
        test: unexpected
      };
      runMocked(testSuite, globals, done, function () {
        assert(beforeEachReached, 'global beforeEach reached');
        assert(afterEachReached, 'global afterEach reached');
        assert(!unexpectedReached, 'suite hooks or test not reached');
      });
    },

    // TODO:
    '!!! possibly runner resolve problems in master': !function (done) {
      var odone = done;
      done = function(){
        console.log('UNIT DONE')
        odone.apply(null, arguments)
      }

      var testAReached = false;
      var testBReached = false;
      var testSuites = [
        {
          testA: function (browser) {
            console.log('TEST A')
            browser.assert.ok(false, 'testA sync fail');
            testAReached = true;
            throw new Error('hi')
          }
        },
        {
          testB: function () {
            console.log('TEST B')
            testBReached = true;
          }
        }
      ];
      var opts = {
        skip_testcases_on_fail: true
      };
      runMocked(testSuites, null, done, function (err, results) {
        console.log('RUN DONE');
        assert(testAReached, 'testA reached');
        assert(testBReached, 'testB reached');
        // TODO: check results
        results;
      }, opts);
    },

    'synchronous asserts respect skip_testcases_on_fail': function (done) {
      var testAReached = false;
      var testBReached = false;

      var testSuite = {
        testA: function (browser) {
          console.log('TEST A')
          browser.assert.ok(false, 'testA sync fail');
          testAReached = true;
        },
        testB: function () {
          console.log('TEST B')
          testBReached = true;
        }
      };
      var opts = {
        skip_testcases_on_fail: true
      };
      runMocked(testSuite, null, done, function (err, results) {
        console.log('RUN DONE');
        assert(testAReached, 'testA reached');
        assert(!testBReached, 'testB reached');
        // TODO: check results
        results;
      }, opts);
    },



  }
};

function runMocked(suites, globals, done, completeHandler, opts, addOpts) {

  var testOpts = {
    seleniumPort: 10195,
    silent: true,
    output: false
  };

  for (var opt in opts) {
    testOpts[opt] = opts[opt];
  }
  testOpts.globals = globals || testOpts.globals;

  var testAddOpts = {
    output_folder: false,
    start_session: true
  };

  for (var addOpt in addOpts) {
    testAddOpts[addOpt] = addOpts[addOpt];
  }

  if (!Array.isArray(suites)) {
    suites = [suites];
  }

  var testPaths = createMocks(suites);
  console.log(testPaths)
  var Runner = common.require('runner/run.js');

  var runner = new Runner(testPaths, testOpts, testAddOpts, function () {
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
}

function createMocks (suites) {
  var testPaths = suites.map(function (suite, index) {
    var testPath = path.join(__dirname, 'mockedTestSuite_' + index + '.js');
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