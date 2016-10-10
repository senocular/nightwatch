var path = require('path');
var util = require('util');
var events = require('events');
var Q = require('q');
var ClientManager = require('./clientmanager.js');
var Module = require('./module.js');
var TestCase = require('./testcase.js');
var Logger = require('../util/logger.js');
var Utils = require('../util/utils.js');
var DEFAULT_ASYNC_HOOK_TIMEOUT = 10000;

function noop() {}

var sessionHooks = {before: 1, beforeEach: 1, after: 0, afterEach: 0};
function hookWillStartSession (hookName) {
  return sessionHooks[hookName] === 1;
}

function TestSuite(modulePath, fullPaths, opts, addtOpts) {
  events.EventEmitter.call(this);

  this['@testCase'] = null;
  this.deferred = Q.defer();
  this.module = new Module(modulePath, opts, addtOpts);
  this.setTestResult();
  this.currentTest = '';
  this.module.setReportKey(fullPaths, addtOpts.src_folders);
  this.options = opts;
  this.testMaxRetries = addtOpts.retries || 0;
  this.suiteMaxRetries = addtOpts.suite_retries || 0;
  this.suiteRetries = 0;
  this.suiteName = this.module.getTestSuiteName() || Utils.getTestSuiteName(this.module.moduleKey);
  this.setupClient();
  this.currentHookTimeoutId = null;
  this.stepHasTerminated = false;
  this.initHooks();
}

util.inherits(TestSuite, events.EventEmitter);

TestSuite.prototype.setupClient = function() {
  this.updateDesiredCapabilities();
  this.client = new ClientManager();
  var self = this;
  this.client.on('error', function(err) {
    self.complete(err);
  });
  this.client.init(this.options);
  this.client.api('currentEnv', this.options.currentEnv);
  this.module.set('client', this.client.api());
  if (this.client.endSessionOnFail() && !this.module.endSessionOnFail()) {
    this.client.endSessionOnFail(false);
  }
};

TestSuite.prototype.initHooks = function() {
  var self = this;
  var context = this.module.get();
  var hooks = ['before', 'after', ['beforeEach', 'setUp'], ['afterEach', 'tearDown']];

  this.hooks = {};

  hooks.forEach(function(item) {
    var hook = self.pullModuleKey(item);
    self.hooks[hook.name] = function() {
      return self.runHook(hook.name, context, hook.fn);
    };
  });
};

TestSuite.prototype.pullModuleKey = function(key) {

    var firstKey = Array.isArray(key) ? key[0] : key;
    var methodKey = firstKey;

    var index = this.testResults.steps.indexOf(methodKey);
    if (index === -1 && Array.isArray(key)) {
      methodKey = key[1];
      index = this.testResults.steps.indexOf(methodKey);
    }

    if (index > -1) {
      this.testResults.steps.splice(index, 1);
      this.module.removeKey(key);
    }

    return {
      name: firstKey,
      fn: this.module.get(methodKey) || noop
    };
};

TestSuite.prototype.run = function() {
  this.print();
  if (this.module.isDisabled()) {
    if (this.options.output) {
      console.log(Logger.colors.cyan(this.module.getName()), 'module is disabled, skipping...');
    }
    this.complete();
  } else {

    var self = this;

    // TODO: do we do this only on first run? What about retries? Is that taken care of elsewhere? is this persistent?
    // or does runNext override this guy anyway? Is this one not needed?
    this.setCurrentTest();

    this.runSuite()
      .then(function() {
          self.complete();
      })
      .catch(function(err) {
          self.complete(err);
      });
  }

  return this.deferred.promise;
};

TestSuite.prototype.runSuite = function() {

  var self = this;
  var fatalErrs = [];
  function onFatalError (err) {
    fatalErrs.push(err);
  }

  return this.globalBeforeEach()
    .then(function() {

      if (self.shouldSkip()) { // when does this happen and not fatal?
        console.log('TERMINATED (expected for GLOBAL.BEFORE)');
        self.testResults.errmessages = self.client.errors(); // TODO: what's this reporting step? Why specific to this place? Needed elsewhere?
        return null;
      }

      return self.runTestSuiteModule()
        .catch(onFatalError); // ensures globalAfterEach always gets called
    }, onFatalError)
    .then(function() {
      return self.globalAfterEach()
        .catch(onFatalError);
    })
    .then(function() {
      var firstErr = fatalErrs[0];
      if (firstErr) {
        console.log('ERRORS FOUND (run)! Using first of', fatalErrs.length);
        throw firstErr;
      }
    });
};

TestSuite.prototype.shouldSkip = function() {
  return (this.stepHasTerminated || this.client.terminated()) && this.client.skipTestcasesOnFail();
};

TestSuite.prototype.getCurrentTestCase = function() {
  return this['@testCase'];
};

TestSuite.prototype.getReportKey = function() {
  return this.module.moduleKey;
};

TestSuite.prototype.getGroupName = function() {
  return this.module.groupName;
};

TestSuite.prototype.getAsyncHookTimeout = function() {
  return this.client.globals('asyncHookTimeout') || DEFAULT_ASYNC_HOOK_TIMEOUT;
};

TestSuite.prototype.printResult = function(startTime) {
  return this.client.print(startTime);
};

TestSuite.prototype.shouldRetrySuite = function() {
  return this.suiteMaxRetries > this.suiteRetries && (this.testResults.failed > 0 || this.testResults.errors > 0);
};

TestSuite.prototype.setTestResult = function() {
  this.testResults = {};
  this.testResults.steps = this.module.keys.slice(0);
  this.clearTestResult();
  return this;
};

TestSuite.prototype.clearTestResult = function() {
  this.testResults.passed = 0;
  this.testResults.failed = 0;
  this.testResults.errors = 0;
  this.testResults.errmessages = [];
  this.testResults.skipped = 0;
  this.testResults.tests = 0;
  this.testResults.testcases = {};
  this.testResults.timestamp = new Date().toUTCString();
  this.testResults.time = 0;
  return this;
};

TestSuite.prototype.clearResult = function() {
  this.clearTestResult();
  this.client.clearGlobalResult();
  return this;
};

TestSuite.prototype.printRetry = function() {
  if (this.options.output) {
    console.log('Retrying: ',
      Logger.colors.red('[' + this.suiteName + '] Test Suite '),
      '(' + this.suiteRetries + '/' + this.suiteMaxRetries + '): ');
  }
};

TestSuite.prototype.resetForSuiteRetry = function() {
  this.client.resetTerminated();
  this.clearResult();
  this.suiteRetries +=1;
  this.resetTestCases();
  this.printRetry();
};

TestSuite.prototype.runTestSuiteModule = function() {

  var self = this;
  var fatalErrs = [];
  function onFatalError (err) {
    fatalErrs.push(err);
  }

  return this.before()
    .then(function() {
      return self.runNextTestCase()
        .catch(onFatalError);
    }, onFatalError)
    .then(function() {

      self['@testCase'] = null;

      return self.after()
        .catch(onFatalError);
    })
    .then(function() {
      if (!fatalErrs.length && self.shouldRetrySuite()) { // TODO: presuming fatal errors should not retry? whats failures vs errors
        self.resetForSuiteRetry();
        return self.runSuite(); // TODO: catch?
      }
    })
    .then(function() {
      var firstErr = fatalErrs[0];
      if (firstErr) {
        console.log('ERRORS FOUND (runTestSuiteModule)! Using last of', fatalErrs.length);
        throw firstErr;
      }
    })
    .catch(function(err) {
      self.testResults.errors++; // TODO: more logging than just ++? Does this duplicate nested retry error counts?
      throw err;
    });
};

TestSuite.prototype.onTestCaseFinished = function(results, errors, time) {
  this.testResults.time += time;
  this.testResults.testcases[this.currentTest] = this.testResults.testcases[this.currentTest] || {};
  this.testResults.testcases[this.currentTest].time = (time/1000).toPrecision(4);

  this.emit('testcase:finished', results, errors, time);
};

TestSuite.prototype.resetTestCases = function() {
  var self = this;
  this.module.resetKeys();
  Object.keys(this.hooks).forEach(function(hook) {
    self.module.removeKey(hook);
  });
};

TestSuite.prototype.setCurrentTest = function(currentTest) {
  if (currentTest !== undefined) {
    this.currentTest = currentTest;
  }
  var moduleKey = this.getReportKey();
  this.client.clearGlobalResult();

  this.client.api('currentTest', {
    name : this.currentTest,
    module : moduleKey.replace(path.sep , '/'),
    results : this.testResults,
    group : this.getGroupName()
  });
  return this;
};

TestSuite.prototype.runNextTestCase = function(deferred) {
  this.setCurrentTest(this.module.getNextKey());

  deferred = deferred || Q.defer();
  if (this.currentTest) {
    this.pullModuleKey(this.currentTest);
    this.runTestCase(this.currentTest, deferred, 0);
  } else {
    deferred.resolve();
  }

  return deferred.promise;
};

TestSuite.prototype.runTestCase = function(currentTest, deferred, numRetries) {
  var self = this;

  this['@testCase'] = new TestCase(this, currentTest, numRetries, this.testMaxRetries);

  if (self.shouldSkip()) {
    console.log('TERMINATED (expected for TESTCASE.BEFORE)');
    deferred.resolve();
    return;
  }

  this['@testCase'].print().run().then(function(response) {
    var foundFailures = !!(response.results.failed || response.results.errors);

    if (foundFailures && numRetries < self.testMaxRetries) {
      numRetries++;
      self.client.resetTerminated();
      self.clearResult();
      self.runTestCase(currentTest, deferred, numRetries);
    } else if (foundFailures && self.suiteRetries < self.suiteMaxRetries) {
      deferred.resolve();
    } else {
      self.onTestCaseFinished(response.results, response.errors, response.time);

      if (self.shouldSkip()) {
        console.log('TERMINATED (expected for TESTCASE)');
        deferred.resolve();
      } else {
        process.nextTick(function() {
          self.runNextTestCase(deferred);
        });
      }
    }
  }, function(error) { // TODO: doesn't catch sync errors in then resolve above
    deferred.reject(error);
  });
};

//////////////////////////////////////////////////////////////////////
// Test suite hooks
//////////////////////////////////////////////////////////////////////
TestSuite.prototype.before = function() {
  return this.hooks.before();
};

TestSuite.prototype.after = function() {
  return this.hooks.after();
};

TestSuite.prototype.beforeEach = function() {
  this.resetCapturedTerminated();
  return this.hooks.beforeEach();
};

TestSuite.prototype.afterEach = function(results, errors) {
  return this.hooks.afterEach().then(function() { // TODO: figure out "fatal" failures + publish results?
    this.module
      .set('results', results)
      .set('errors', errors);
    this.client.publishTestResults(this.currentTest, results, errors);
  }.bind(this));
};

//////////////////////////////////////////////////////////////////////
// Global hooks
//////////////////////////////////////////////////////////////////////
TestSuite.prototype.globalBeforeEach = function() {
  return this.runHook('beforeEach', this.options.globals);
};

TestSuite.prototype.globalAfterEach = function() {
  return this.runHook('afterEach', this.options.globals);
};

/**
 * TODO: describe the running of the hooks (and doc other methods added)
 */
TestSuite.prototype.runHook = function(hookName, context, hookFn) {
  hookFn = hookFn || Utils.checkFunction(hookName, context) || noop;

  var self = this;
  var hookDesc = isGlobal ? 'global ' + hookName : hookName;
  var isGlobal = context === this.options.globals;
  var isSuiteAfterEach = !isGlobal && hookName === 'afterEach'; // different arg behavior for back compat :P
  var singleParamUsesDone = isGlobal || isSuiteAfterEach || this.options.compatible_testcase_support; // uses fn(done) instead of fn(browser)

  return this.makePromise(function(done) {

    function hooklog () {
      return;
      console.log.apply(console, arguments);
    }

    var hookDoneImpl = done; // may be done, or done with a timeout

    function completeHook(err, isFatalErr) {            hooklog('HOOK COMPLETE', hookDesc, 'error?', !!err)
      self.client.emptyQueue().resetQueue(); // TODO: remove and just let it fly? Could this mess things up for a pending command? test
      self.addErrorToResults(err);
      if (err && isFatalErr) {
        hookDoneImpl(err);
      } else {
        hookDoneImpl();
      }
    }

    // calling hook done() and command queue completion
    // is a race condition; each checks for the other

    var methodDoneCalled = false;

    function methodDone(err) {                          hooklog('HOOK methodDone', hookDesc)
      methodDoneCalled = true;
      if (!self.client.shouldRestartQueue()) {
        completeHook(err, true);
      }                                                 else hooklog('HOOK methodDone WAITING...')
    }

    function queueDone(err) {                           hooklog('HOOK queueDone', hookDesc)
      if (methodDoneCalled) {
        completeHook(err);
      }                                                 else hooklog('HOOK queueDone WAITING...')
    }

    var paramCount = hookFn.length;
    var hasApiParam = paramCount >= 2 || !singleParamUsesDone;                        // fn(browser,done) || fn(browser)
    var hasDoneParam = paramCount >= 2 || (paramCount === 1 && singleParamUsesDone) ; // fn(browser,done) || fn(done)

    var args = hasApiParam ? [this.client.api(), methodDone] : [methodDone];
    var asyncArgCount = hasDoneParam ? paramCount : args.length;
    var hookMethod = Utils.makeFnAsync(asyncArgCount, hookFn, context);

    try {
      hookMethod.apply(context, args);
    } catch (err) {                                     hooklog('CAUGHT', err)
      completeHook(err, true);
      return;
    }

    var isAsyncHook = !methodDoneCalled || this.client.shouldRestartQueue();
    if (isAsyncHook) {

      // adding timeout to done after calling the hook method
      // allows the hook method to set its own timeout time
      hookDoneImpl = this.addTimeoutToDoneCallback(done, hookDesc, function onHookTimeout(err, fnName, timeout) {
        completeHook(err, true);
      });

      // sync asserts will terminate the session when aborting-on-failure
      // but if we're restarting the session below, we need to record
      // the fact that the session had been terminated
      this.captureTerminated();
      // TODO: does this apply to before/after/gEaches? What's the skip policy for errors there?

      if (this.client.shouldRestartQueue()) {
        if (hookWillStartSession(hookName)) {
          this.client.start(queueDone);
        } else {
          this.client.restartQueue(queueDone);
        }
      }
    }

  });
};

TestSuite.prototype.resetCapturedTerminated = function() {
  this.stepHasTerminated = false;
};

TestSuite.prototype.captureTerminated = function() {
  if (this.client.terminated()) {
    this.stepHasTerminated = true;
  }
};

TestSuite.prototype.addErrorToResults = function(err) {
   // TODO: distinctions of source of errors? (global, suite vs tc, etc.)
   // errors vs failures?
  if (err) {
    this.testResults.errors++;
    this.testResults.errmessages = [err.message];
  }
  return this;
};

TestSuite.prototype.addTimeoutToDoneCallback = function(done, hookDesc, errorHandler) {
  return Utils.setCallbackTimeout(done, hookDesc, this.getAsyncHookTimeout(), errorHandler, function(timeoutId) {
    this.currentHookTimeoutId = timeoutId;
  }.bind(this));
};

TestSuite.prototype.clearHookTimeout = function() {
  if (this.currentHookTimeoutId !== null) {
    clearTimeout(this.currentHookTimeoutId);
    this.currentHookTimeoutId = null;
  }
};

//////////////////////////////////////////////////////////////////////
// Utilities
//////////////////////////////////////////////////////////////////////
TestSuite.prototype.makePromise = function (fn) {
  var deferred = Q.defer();
  try {
    fn.call(this, function(err) {
      if (Utils.isErrorObject(err)) {
        deferred.reject(err);
      } else {
        deferred.resolve();
      }
    }, deferred);
  } catch (e) {
    deferred.reject(e);
  }

  return deferred.promise;
};

TestSuite.prototype.updateDesiredCapabilities = function() {
  this.options.desiredCapabilities = this.options.desiredCapabilities || {};
  if (this.options.sync_test_names || (typeof this.options.sync_test_names == 'undefined')) {
    // optionally send the local test name (derived from filename)
    // to the remote selenium server. useful for test reporting in cloud service providers
    this.options.desiredCapabilities.name = this.suiteName;
  }

  if (this.module.desiredCapabilities()) {
    for (var capability in this.module.desiredCapabilities()) {
      if (this.module.desiredCapabilities().hasOwnProperty(capability)) {
        this.options.desiredCapabilities[capability] = this.module.desiredCapabilities(capability);
      }
    }
  }
};

TestSuite.prototype.print = function() {
  if (this.options.output) {
    var testSuiteDisplay;
    if (this.options.start_session) {
      testSuiteDisplay = '[' + this.suiteName + '] Test Suite';
    } else {
      testSuiteDisplay = this.module.getTestSuiteName() || this.module.moduleKey;
    }

    if (this.options.test_worker && !this.options.live_output) {
      process.stdout.write('\\n');
    }

    var output = '\n' + Logger.colors.cyan(testSuiteDisplay) + '\n' + Logger.colors.purple(new Array(testSuiteDisplay.length + 5).join('='));
    console.log(output);

  }
};

TestSuite.prototype.complete = function(err) {
  if (err) {
    this.deferred.reject(err);
  } else {
    this.deferred.resolve(this.testResults);
  }
};

TestSuite.prototype.catchHandler = function(err) {
  this.complete(err);
};

module.exports = TestSuite;
