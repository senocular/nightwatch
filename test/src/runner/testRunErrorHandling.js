var path = require('path');
var assert = require('assert');
var mockery = require('mockery');
var common = require('../../common.js');
var Nightwatch = common.require('index.js');
var CommandGlobals = require('../../lib/globals/commands.js');

var TestHistory = {
  ALL: [
    'global.before',
    'global.beforeEach','suite.before',
    'suite.beforeEach','suite1.testcase1','suite.afterEach',
    'suite.beforeEach','suite1.testcase2','suite.afterEach',
    'suite.after','global.afterEach',
    'global.beforeEach','suite.before',
    'suite.beforeEach','suite2.testcase1','suite.afterEach',
    'suite.beforeEach','suite2.testcase2','suite.afterEach',
    'suite.after','global.afterEach',
    'global.after'
  ]
};

// TODO: abortOnFailure - figure out how it plays in Assertions
// TODO: turn errorTesting.output off

module.exports = {
  'testRunErrorHandling' : {

    beforeEach: function (done) {

      mockery.enable({ useCleanCache: true, warnOnReplace : false, warnOnUnregistered: false });
      mockery.registerMock('./custom.json', {
        src_folders : ['./test/sampletests/witherrors'],
        globals_path : './test/extra/globals-witherrors.js',
        output_folder : false,
        output : false,
        selenium : {
          start_process : false,
          start_session : true
        },
        test_workers : false,
        end_session_on_fail: false,
        skip_testcases_on_fail: true,
        test_settings : {
          'default' : {
            silent : true
          }
        }
      });

      mockery.registerMock('fs', mockOver('fs', {
        statSync : function(file) {
          switch(file) {
          case './custom.json':
            return {
              isFile : function() {
                return true;
              }
            };
          }
          return this.statSync(file);
        }
      }));

      mockery.registerMock('path', mockOver('path', {
        resolve: function(file) {
          switch(file) {
          case './custom.json':
            return file;
          }
          return this.resolve(file);
        }
      }));

      CommandGlobals.beforeEach.call(this, done);
    },

    afterEach: function (done) {
      mockery.deregisterAll();
      mockery.resetCache();
      mockery.disable();
      CommandGlobals.afterEach.call(this, done);
    },

    testRunWithErrors: function (done) {
      runTest({
        output: true,
        errorAt: ['suite1','testcase1','sync','expect'],
        test_settings: {}
      }, function (runner, globals, doneCallbackArgs) {

        var history = globals.errorTesting.history;
        assert.deepEqual(history, TestHistory.ALL, 'call history');

        var errorTest = globals.errorTesting.testcases['suite1.testcase1'];
        assert.equal(errorTest.results.failed, 1, 'test failures');

      }, done);
    },

    testRunWithErrors2: function (done) {
      runTest({
        output: true,
        errorAt: [],
        test_settings: {}// selenium:{start_session: false} }
      }, function (runner, globals, doneCallbackArgs) {

        var history = globals.errorTesting.history;
        assert.deepEqual(history, TestHistory.ALL, 'call history');

        var errorTest = globals.errorTesting.testcases['suite1.testcase1'];
        assert.equal(errorTest.results.failed, 0, 'test failures');

      }, done);
    }
  }
};

function runTest(options, callback, done) {

  try {

    var test_settings = options.test_settings || {};
    test_settings.globals = test_settings.globals || {};
    test_settings.globals.errorTesting = test_settings.globals.errorTesting || {};

    parseErrorAt(options.errorAt, test_settings);
    if ('output' in options) {
      test_settings.globals.errorTesting.output = options.output;
    }

    var argv = options.argv || {};
    argv.config = argv.config || './custom.json';

    var runner;

    var complete = function () {
      try {
        callback(runner, runner.test_settings.globals, arguments);
        done();
      } catch (err) {
        done(err);
      }
    };

    runner = Nightwatch.runner(argv, complete, test_settings);

  } catch (err) {
    done(err);
  }
}

function parseErrorAt(errorAt, test_settings) {
  if (!errorAt || !errorAt.length) {
    errorAt = [];
  } else {

    if (!Array.isArray(errorAt[0])) {
      errorAt = [errorAt];
    }

    errorAt = errorAt.map(function(errorAt) {
      return {
        context: errorAt[0],
        name:    errorAt[1],
        timing:  errorAt[2],
        error:   errorAt[3],
        count:   errorAt[4]
      };
    });
  }

  test_settings.globals.errorTesting.test = errorAt;
}

function mockOver(module, methods) {
  var orig = require(module);
  var mock = Object.create(orig);
  for (var name in methods) {
    mock[name] = methods[name].bind(orig);
  }
  return mock;
}