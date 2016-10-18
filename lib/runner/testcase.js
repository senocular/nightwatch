var Q = require('q');
var Logger = require('../util/logger.js');
var Utils = require('../util/utils.js');
var Reporter = require('../runner/reporter.js');
var DEFAULT_UNITTEST_HOOK_TIMEOUT = 2000;

function TestCase(suite, testName, testFn, numRetries, maxRetries) {
  this.suite = suite;
  this.testName = testName;
  this.testFn = testFn;
  this.numRetries = numRetries;
  this.maxRetries = maxRetries;
  this.currentDeferred = null; // test case run deferred
  this.testDeferred = null; // test case call deferred
  this.running = false;
  this.lastTimerId = null;
}

TestCase.prototype.print = function () {
  var opts = this.suite.options;

  if (opts.output && opts.start_session && opts.detailed_output) {
    process.stdout.write('\n');
    if (this.numRetries > 0) {
      console.log('Retrying (' + this.numRetries + '/' + this.maxRetries + '): ',
        Logger.colors.red(this.testName));
    } else {
      console.log((opts.parallelMode && !opts.live_output ? 'Results for: ' : 'Running: '),
        Logger.colors.green(this.testName));
    }
  }
  return this;
};

TestCase.prototype.getTestCaseTimeout = function () {
  if (this.suite.client.options.start_session) {
    return -1;
  }
  return this.suite.client.globals('asyncHookTimeout') || DEFAULT_UNITTEST_HOOK_TIMEOUT;
};

TestCase.prototype.run = function () {
  var self = this;
  var testCaseErrs = [];
  function onTestCaseError (err) {
    testCaseErrs.push(err);
  }
  
  this.currentDeferred = Q.defer();
  this.running = true;

  var testContext = self.suite.module.get();
  var startTime = new Date().getTime();

  this.suite.beforeEach()
    .then(function() {

      

      if (self.suite.client.terminated()) {
        // TODO: make sure verify only errors don't trigger this
        console.log('TERMINATED (expected for TESTCASE.BEFOREEACH)');
        return;
      }

      return self.suite.runTestMethod(self.testName, testContext, null, self.getTestCaseTimeout())
        .catch(onTestCaseError); // ensure afterEach runs
    }, onTestCaseError)
    .then(function() {
      return self.suite.afterEach()
        .catch(onTestCaseError);
    })
    .then(function() {

      var firstErr = testCaseErrs[0];
      if (firstErr) {
        console.log('ERRORS FOUND (tc.run)! Using first of', testCaseErrs.length);
        throw firstErr;
      } else {
        var time = new Date().getTime() - startTime;
        self.currentDeferred.resolve(time);
      }

      self.running = false;
    })
    .catch(function(error) {
      self.currentDeferred.reject(error);
      self.running = false;
    });

  return self.currentDeferred.promise;
};

TestCase.prototype.doneCallback = function(err) {

  // TODO:
  if (Utils.isErrorObject(err)) {
    this.suite.client.handleException(err);
  }

  if (!this.suite.options.start_session && this.suite.options.output && this.currentDeferred) {
    this.currentDeferred.promise.then(function(results) {
      console.log(Reporter.getTestOutput(err, this.testName, results.time));
    }.bind(this));
  }
};


module.exports = TestCase;
