var path = require('path');
var assert = require('assert');
var common = require('../../common.js');
var CommandGlobals = require('../../lib/globals/commands.js');
var Nightwatch = common.require('index.js');

var errorConfig = path.join(__dirname, '../../extra/witherrors.json');
var TestHistory = {
  ALL: [
    'global.before','global.beforeEach','suite.before',
    'suite.beforeEach','test.test1','suite.afterEach',
    'suite.beforeEach','test.test2','suite.afterEach',
    'suite.after','global.afterEach','global.after'
  ]
};

// TODO: abortOnFailure - figure out how it plays in Assertions
// TODO: turn errorTesting.output off

module.exports = {
  'testRunErrorHandling' : {

    before: function (done) {
      CommandGlobals.beforeEach.call(this, done);
    },

    after: function (done) {
      CommandGlobals.afterEach.call(this, done);
    },

    testRunWithErrors: function (done) {
      runErrorTest({
        errorAt: ['test','test1','sync','assert']
      }, function (errorTesting, runner, doneArgs) {
        assert.deepEqual(errorTesting.history, TestHistory.ALL, 'call history');
      }, done);
    }
  }
};

function runErrorTest(options, callback, done) {

  try {

    var errorAt = options.errorAt;
    var test = { // TODO: check these are being picked up
      context: errorAt[0],
      name:    errorAt[1],
      timing:  errorAt[2],
      error:   errorAt[3]
    };

    var runner;
    var argv = { config: errorConfig };
    var test_settings = { globals: { errorTesting: { test: test } } };

    var complete = function () {
      try {
        callback(runner.test_settings.globals.errorTesting, runner, arguments);
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