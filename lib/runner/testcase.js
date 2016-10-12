var Q = require('q');
var Logger = require('../util/logger.js');
var Utils = require('../util/utils.js');
var Reporter = require('../runner/reporter.js');
var DEFAULT_UNITTEST_HOOK_TIMEOUT = 2000;

function TestCase(suite, testFn, numRetries, maxRetries) {
  this.suite = suite;
  this.testFn = testFn;
  this.numRetries = numRetries;
  this.maxRetries = maxRetries;
  this.currentDeferred = null; // test case run deferred
  this.testFnDeferred = null; // test case call deferred
  this.running = false;
  this.lastTimerId = null;
}

TestCase.prototype.print = function () {
  var opts = this.suite.options;

  if (opts.output && opts.start_session && opts.detailed_output) {
    process.stdout.write('\n');
    if (this.numRetries > 0) {
      console.log('Retrying (' + this.numRetries + '/' + this.maxRetries + '): ',
        Logger.colors.red(this.testFn));
    } else {
      console.log((opts.parallelMode && !opts.live_output ? 'Results for: ' : 'Running: '),
        Logger.colors.green(this.testFn));
    }
  }
  return this;
};

TestCase.prototype.getUnitTestTimeout = function () {
  return this.suite.client.globals('asyncHookTimeout') || DEFAULT_UNITTEST_HOOK_TIMEOUT;
};

TestCase.prototype.run = function () {
  var self = this;
  var fatalErrs = [];
  function onFatalError (err) {
    fatalErrs.push(err);
  }
  
  this.currentDeferred = Q.defer();
  this.running = true;

  var startTime = new Date().getTime();

  this.suite.beforeEach()
    .then(function() {

      if (self.suite.client.terminated()) {
        // TODO: make sure verify only errors don't trigger this'
        console.log('TERMINATED (expected for TESTCASE.BEFOREEACH)');
        return;
      }

      return self.runTestMethod()
        .catch(onFatalError); // ensure afterEach runs
    }, onFatalError)
    .then(function() {
      return self.suite.afterEach()
        .catch(onFatalError);
    })
    .then(function() {

      var firstErr = fatalErrs[0];
      if (firstErr) {
        console.log('ERRORS FOUND (tc.run)! Using first of', fatalErrs.length);
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

TestCase.prototype.runTestMethod = function () {
  this.testFnDeferred = Q.defer();

  var self = this;

  this.suite.client.once('complete', function() {
    if (self.suite.client.options.start_session) {
      self.testFnDeferred.resolve();
    }
  }).once('error', function(result) {
    self.testFnDeferred.reject(result);
  });

  try {
    if (this.suite.client.options.start_session) {
      this.suite.module.call(this.testFn, this.suite.client.api());
    } else {

      var doneFn = this.setDoneCallbackTimer(this.doneCallback.bind(this), this.testFn, function(timeoutId) {
        timeoutId.currentTest = self.testFn;
        self.lastTimerId = timeoutId;
      });

      this.suite.module.callAsync(this.testFn, this.suite.client.api(), doneFn, this.suite.expectedAsyncArgs);
    }
    this.suite.client.start();
  } catch (err) {
    console.log('TC CAUGHT')
    this.catchHandler(err);
  }

  return this.testFnDeferred.promise;
}

TestCase.prototype.setDoneCallbackTimer = function(done, fnName, onTimerStarted) {
  return Utils.setCallbackTimeout(done, fnName, this.getUnitTestTimeout(), function(err) {
    throw err;
  }, onTimerStarted);
};

TestCase.prototype.doneCallback = function(err) {

  console.log('TC DONE', err)
  if (this.lastTimerId) {
    clearTimeout(this.lastTimerId);
    this.lastTimerId = null;
  }

  this.suite.clearHookTimeout();

  if (this.testFnDeferred) {
    this.testFnDeferred.resolve();
  }

  if (Utils.isErrorObject(err)) {
    this.setFailed(err);
  }

  if (!this.suite.options.output || !this.currentDeferred) {
    return;
  }

  if (!this.suite.options.start_session) {
    this.currentDeferred.promise.then(function(results) {
      console.log(Reporter.getTestOutput(err, this.testFn, results.time));
    }.bind(this));
  }

  if (err && this.suite.options.start_session) {
    this.suite.client.terminate();
  }
};

TestCase.prototype.setFailed = function(err) {
  this.suite.client.handleException(err);
};

TestCase.prototype.catchHandler = function(err) {
  this.doneCallback(err);
};

module.exports = TestCase;
