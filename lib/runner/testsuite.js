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
  this.currentHookComplete = null;
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
    self.hooks[hook.name] = function suiteHook() {
      return self.runHookMethod(hook.name, context, hook.fn);
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

      if (self.shouldSkipRemaining()) {
        console.log('TERMINATED (expected for GLOBAL.BEFOREEACH)');
        self.addErrorToResults(self.client.errors()); // TODO: what's this reporting step? Isn't it already recorded?
        return null;
      }

      return self.runTestSuiteModule()
        .catch(onFatalError); // ensure globalAfterEach runs
    }, onFatalError)
    .then(function() {
      return self.globalAfterEach()
        .catch(onFatalError);
    })
    .then(function() {
      var firstErr = fatalErrs[0];
      if (firstErr) {
        console.log('ERRORS FOUND (ts.run)! Using first of', fatalErrs.length);
        throw firstErr;
      }
    });
};

TestSuite.prototype.shouldSkipRemaining = function() {
  return this.client.terminated() && this.client.skipTestcasesOnFail();
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
        .catch(onFatalError); // ensure after runs
    }, onFatalError)
    .then(function() {

      self['@testCase'] = null;

      return self.after()
        .catch(onFatalError);
    })
    .then(function() {
      if (!fatalErrs.length && self.shouldRetrySuite()) {
        self.resetForSuiteRetry();
        return self.runSuite();
      }

      var firstErr = fatalErrs[0];
      if (firstErr) {
        console.log('ERRORS FOUND (runTestSuiteModule)! Using last of', fatalErrs.length);
        throw firstErr;
      }
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

  if (self.shouldSkipRemaining()) {
    console.log('TERMINATED (expected for TESTCASE.BEFORE)');
    deferred.resolve();
    return;
  }

  // TODO: are we handling a fatal error stopping retries here?

  this['@testCase'].print().run().then(function(time) {
    
    var response = {
      results: self.client.results(),
      errors: self.client.errors(),
      time: time
    };

    self.module
      .set('results', response.results)
      .set('errors', response.errors);

    self.client.publishTestResults(self.currentTest, self.module.get('results'));

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

      if (self.shouldSkipRemaining()) {
        console.log('TERMINATED (expected for TESTCASE)');
        deferred.resolve();
      } else {
        process.nextTick(function() {
          self.runNextTestCase(deferred);
        });
      }
    }
  }).catch(function(error) {
    deferred.reject(error);
  });
};

//////////////////////////////////////////////////////////////////////
// Hooks
//////////////////////////////////////////////////////////////////////
TestSuite.prototype.before = function() {
  return this.hooks.before();
};

TestSuite.prototype.after = function() {
  return this.hooks.after();
};

TestSuite.prototype.beforeEach = function() {
  return this.hooks.beforeEach();
};

TestSuite.prototype.afterEach = function() {
  return this.hooks.afterEach();
};

TestSuite.prototype.globalBeforeEach = function() {
  return this.runHookMethod('beforeEach', this.options.globals);
};

TestSuite.prototype.globalAfterEach = function() {
  return this.runHookMethod('afterEach', this.options.globals);
};

/**
 * TODO: document!
 */
TestSuite.prototype.runHookMethod = function(hookName, context, hookFn) {
  hookFn = hookFn || Utils.checkFunction(hookName, context) || noop;

  var self = this;
  var isGlobal = context === this.options.globals;
  var hookDesc = isGlobal ? 'global ' + hookName : hookName;
  var isSuiteAfterEach = !isGlobal && hookName === 'afterEach'; // different arg behavior for back compat :P
  var singleParamUsesDone = isGlobal || isSuiteAfterEach || this.options.compatible_testcase_support; // uses fn(done) instead of fn(browser)

  return this.makePromise(function(done) {

    function hooklog () { // TODO: cleanup
      return;
      console.log.apply(console, arguments);
    }

    var hookDoneImpl = done; // may be done, or done with a timeout

    function completeHook(err, isRejectErr) {            hooklog('HOOK COMPLETE', hookDesc, 'error?', !!err)
      if (!hookHasCompleted()) {
        self.currentHookComplete = noop; // until queue cleared
        self.addErrorToResults(err);
        self.clearQueue(err, function () {
          self.currentHookComplete = null;
          if (isRejectErr) {
            hookDoneImpl(err);
          } else {
            hookDoneImpl();
          }
        });
      }
    }

    self.currentHookComplete = completeHook;
    function hookHasCompleted() {
      return self.currentHookComplete !== completeHook;
    }

    // Race condition: calling hook done(), command queue completion, and
    // timeouts all race to complete the hook. The done's (not timeouts)
    // need to check for the other before allowing completion

    var methodDoneCalled = false;
    function methodDone(err) {                          hooklog('HOOK methodDone', hookDesc)
      methodDoneCalled = true;
      if (!self.client.shouldRestartQueue()) { // !empty
        completeHook(err, true); // TODO: if an error, should we skip queue check and terminate? (check abortOnFailure)
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

    try {                                               hooklog('HOOK CALL', hookDesc)
      hookMethod.apply(context, args);                  hooklog('HOOK CALLED', hookDesc)
    } catch (err) {                                     hooklog('HOOK CALL CAUGHT', err)
      self.catchHandler(err);
    }

    if (!hookHasCompleted()) {
      if (this.client.terminated()) { // failed sync assert; TODO: does this spin up an END()?
        completeHook();
      } else {

        var isAsyncHook = !methodDoneCalled || this.client.shouldRestartQueue();
        if (isAsyncHook) {

          // adding timeout to done after calling the hook method
          // allows the hook method to set its own timeout time
          hookDoneImpl = this.addTimeoutToDoneCallback(done, hookDesc, function onHookTimeout(err) {
                                                        hooklog('HOOK TIMEOUT', hookDesc)
            completeHook(err);
          });

          if (this.client.shouldRestartQueue()) {
            this.client.start(queueDone); // done get called on('error')?? done(err) is "last error" - do we log that? (see client)
          }
        }
      }
    }

  });
};

TestSuite.prototype.clearQueue = function(err, clearDone) {
  console.log('CLEAR', this.client.shouldRestartQueue(), err)

  if (err || this.client.shouldRestartQueue()) {
    this.client
      .resetQueue()
      .emptyQueue();
  }

  if (err) { // TODO: can we have an already terminated queue here? Could we double-terminate?
    console.log('END-HOOK TERMINATE()')
    this.client
      .terminate(true)
      .start(clearDone); // TODO: what happens when this on.errors?
  } else {
    clearDone();
  }
};

TestSuite.prototype.addErrorToResults = function(errs) {
  if (errs) {
    if (!Array.isArray(errs)) {
      errs = [errs];
    }
    errs.forEach(function (err) {
      this.testResults.errors++;
      this.testResults.errmessages.push(err.message);
    }.bind(this));
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
  this.clearHookTimeout();
  // TODO: cleanup any running hook? - this can be invoked from a nightwatch on('error')
  if (err) {
    this.deferred.reject(err);
  } else {
    this.deferred.resolve(this.testResults);
  }
};

TestSuite.prototype.catchHandler = function(err) {
  if (this.currentHookComplete) {
    this.currentHookComplete(err, true);
  } else if (this['@testCase']) {
    this['@testCase'].catchHandler(err);
  } else {
    this.complete(err);
  }
};

module.exports = TestSuite;
