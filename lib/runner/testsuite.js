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
  this.fatalQueueError = null;
  this.setupClient();
  this.lastTimerId = null;
  this.currentCatchHandler = null;
  this.stepHasTerminated = false; // TODO: what is this for? I think I added it
  this.initHooks();
}

util.inherits(TestSuite, events.EventEmitter);

TestSuite.prototype.setupClient = function() {
  this.updateDesiredCapabilities();
  this.client = new ClientManager();
  var self = this;
  this.client.on('error', function(errObj) {
    var err = new Error(errObj.message);
    err.data = errObj.data;

    if (!self.fatalQueueError) {
      self.fatalQueueError = err;
    }
    this.catchHandler(err);
  });
  this.client.init(this.options);
  this.client.api('currentEnv', this.options.currentEnv);
  this.module.set('client', this.client.api());
  if (this.client.endSessionOnFail() && !this.module.endSessionOnFail()) {
    this.client.endSessionOnFail(false); // TODO: but this would affect other suites; should change how we check for it rather than assign
  }
};

TestSuite.prototype.initHooks = function() {
  var self = this;
  var context = this.module.get();
  var timeoutTime = this.getAsyncHookTimeout();
  var hooks = ['before', 'after', ['beforeEach', 'setUp'], ['afterEach', 'tearDown']];

  this.hooks = {};

  hooks.forEach(function(item) {
    var hook = self.pullModuleKey(item);
    self.hooks[hook.name] = function suiteHook() {
      return self.runTestMethod(hook.name, context, hook.fn, timeoutTime);
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
      }, function(err) {
          self.complete(err);
      });
  }

  return this.deferred.promise;
};

TestSuite.prototype.runSuite = function() {

  var self = this;
  var suiteErrs = [];
  function onSuiteError (err) {
    suiteErrs.push(err);
  }

  return this.globalBeforeEach()
    .then(function() {

      if (self.shouldSkipRemaining()) {
        console.log('TERMINATED (expected for GLOBAL.BEFOREEACH)');
        self.addErrorToResults(self.client.errors()); // TODO: what's this reporting step? Isn't it already recorded?
        return null;
      }

      return self.runTestSuiteModule()
        .catch(onSuiteError); // ensure globalAfterEach runs
    }, onSuiteError)
    .then(function() {
      return self.globalAfterEach()
        .catch(onSuiteError);
    })
    .then(function() {
      var firstErr = suiteErrs[0];
      if (firstErr) {
        console.log('ERRORS FOUND (ts.run)! Using first of', suiteErrs.length);
        throw firstErr;
      }
    });
};

TestSuite.prototype.shouldSkipRemaining = function() {
  console.log('GETTING SKIP', this.client.terminated(), this.client.skipTestcasesOnFail(),'=>', this.client.terminated() && this.client.skipTestcasesOnFail())
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
  var suiteErrs = [];
  function onSuiteError (err) {
    suiteErrs.push(err);
  }

  return this.before()
    .then(function() {
          console.log('RUNNING FIRST')
      return self.runNextTestCase()
        .catch(onSuiteError); // ensure after runs
    }, onSuiteError)
    .then(function() {

      self['@testCase'] = null;

      return self.after()
        .catch(onSuiteError);
    })
    .then(function() {
      if (!suiteErrs.length && self.shouldRetrySuite()) {
        self.resetForSuiteRetry();
        return self.runSuite();
      }

      var firstErr = suiteErrs[0];
      if (firstErr) {
        console.log('ERRORS FOUND (runTestSuiteModule)! Using last of', suiteErrs.length);
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
    console.log('NO MORE TESTS')
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

  // TODO: are we handling an error stopping retries here?


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
        // TODO: needed?: process.nextTick(function() {
          console.log('RUNNING NEXT')
          self.runNextTestCase(deferred);
        //});
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
  return this.runTestMethod('beforeEach', this.options.globals, null, this.getAsyncHookTimeout());
};

TestSuite.prototype.globalAfterEach = function() {
  return this.runTestMethod('afterEach', this.options.globals, null, this.getAsyncHookTimeout());
};

/**
 * TODO: document!
 */
TestSuite.prototype.runTestMethod = function(methodName, context, methodFn, timeoutTime) {
  methodFn = methodFn || Utils.checkFunction(methodName, context) || noop;

  var self = this;
  var isGlobal = context === this.options.globals;
  var methodDesc = isGlobal ? 'global ' + methodName : methodName;
  var isSuiteAfterEach = !isGlobal && methodName === 'afterEach'; // different arg behavior for back compat :P
  var singleParamUsesDone = isGlobal || isSuiteAfterEach || this.options.compatible_testcase_support; // uses fn(done) instead of fn(browser)

  return self.makePromise(function testMethodPromise(done) {

    done = self.addTimeoutToDoneCallback(done, methodDesc, timeoutTime);

    var methodCalled = false; // sync call of test case/hook function
    var userDoneCalled = false; // user calling done() for async calls (called automatically for non-async calls)
    var completeCalled = false; // if the test case/hook has run to completion
    var queueState = 'empty'; // command queue: 'empty'->'pending'->'complete'

    // Called on the completion of running this test method, usually
    // done asynchronously waiting for method done and/or the queue
    function completeTestMethod(err) {
      self.addErrorToResults(err);

      if (!completeCalled) {
        completeCalled = true;
        
        // TODO: terminate in step or after suite?
        self.clearLastTimeout();
        self.clearQueue(err, function onQueueCleared() {
          done(); // TODO: When do we reject? Do this in currentCatchHandler? Would need to not be blocked by !completeCalled+clearQueue
        });

      } // else actions happening after completion; warn?
    }

    // The done callback supplied to the user for asynchronous hooks. This will
    // need to wait for the method to resolve completely or the command queue
    // to resolve before it is allowed to complete the test method.
    function onUserDone(err) {
      userDoneCalled = true;

      // TODO: terminate?  client.handleException vs addErrorToResults? - will want to terminate on error
      // TODO: probably NOT handleException if retries needs to run the test since it sounds like thats globally recorded
      //    how are retry errors logged?
      if (err) {
        self.addErrorToResults(err, true);
      }

      if (methodCalled && queueState !== 'pending') {
        if (self.client.shouldRestartQueue()) {

          // queue added to after it would have been normally started, or
          // it already completed and new commands were added
          startQueue();

        } else {
          completeTestMethod();
        }
      }
    }

    // Called on the completion of the command queue.  The queue is only
    // ever started after the test method has completed, but may need to
    // wait until the method's done get's called.
    function onQueueDone() {
      queueState = 'complete';
      if (userDoneCalled) {
        completeTestMethod();
      }
    }

    // runs commands in the command queue
    function startQueue() {
        queueState = 'pending';
        self.startQueue(onQueueDone);
    }

    try {
      self.currentCatchHandler = completeTestMethod;
      self.callTestMethod(methodFn, context, onUserDone, singleParamUsesDone);
      
      methodCalled = true;

      if (self.client.terminated()) { // TODO: who is calling terminate? assert?
        completeTestMethod();
      } else if (self.client.shouldRestartQueue()) {
        startQueue();
      } else if (userDoneCalled) {
        onUserDone();
      } // else waiting for user to call onUserDone...

    } catch (err) {
      self.catchHandler(err);
    }
  });
};

TestSuite.prototype.callTestMethod = function(methodFn, context, methodDone, singleParamUsesDone) {
  var paramCount = methodFn.length;
  var hasApiParam = paramCount >= 2 || !singleParamUsesDone;                       // fn(browser,done) || fn(browser)
  var hasDoneParam = paramCount >= 2 || (paramCount === 1 && singleParamUsesDone); // fn(browser,done) || fn(done)

  var args = hasApiParam ? [this.client.api(), methodDone] : [methodDone];
  var asyncArgCount = hasDoneParam ? paramCount : args.length;
  methodFn = Utils.makeFnAsync(asyncArgCount, methodFn, context);
  methodFn.apply(context, args);
};

TestSuite.prototype.clearQueue = function(err, done) {

  if (err && this.options.start_session) { // TODO: can we have an already terminated queue here? Could we double-terminate?
    console.log('clearQueue() TERMINATE()');
    // FIXME: TODO: start resets terminated breaking later is-terminated checks
    // TODO: do we need to check to see if we started before attempting to terminate? (does master do anything there?)
    
    // terminate resets and empties queue
    this.client.terminate(true); // TODO: sync, no-queue g.beforeEach throw calls terminate. Expected?

    // TODO: master doesn't session:start, it only queue:run's
    // TODOL start ()is only needed for deferred terminate, but we're also using it for the done callback
    this.startQueue(done); // TODO: what happens when this on.errors while we wait? Do hooks need to check suite complete before running?
  } else {
    this.client
      .resetQueue()
      .emptyQueue();

    done();
  }
};

/**
 * Starts the command queue through the client manager first checking
 * to see if a fatal queue error has occurred before attempting.
 * @param done {function} Callback to be called when the queue has
 *    completed or called immediately if the queue is never started.
 */
TestSuite.prototype.startQueue = function(done) {
  if (this.fatalQueueError) {
    done();
  } else {
    this.client.start(done);
  }
};

TestSuite.prototype.addErrorToResults = function(errs, treatErrAsFailure) {
  if (errs) {
    if (!Array.isArray(errs)) {
      errs = [errs];
    }

    var errorsAdded = false;
    errs.forEach(function (err) {
      if (treatErrAsFailure) {
        this.client.api().assert.ifError(err);
      } else {
        errorsAdded = true;
        this.testResults.errors++;
        this.testResults.errmessages.push(err.message);
      }
    }.bind(this));

    if (errorsAdded) {
      // TODO: handleException? Call for each? will call multiple terminates...
    }
  }
};

TestSuite.prototype.addTimeoutToDoneCallback = function(done, methodDesc, timeoutTime) {
  if (timeoutTime <= 0) {
    return done;
  }
  return Utils.setCallbackTimeout(done, methodDesc, timeoutTime,
    function onTimeout(err) {
      throw err;
    },
    function onStartTimeout(timeoutId) {
      this.lastTimerId = timeoutId;
    }.bind(this)
  );
};

TestSuite.prototype.clearLastTimeout = function() {
  if (this.lastTimerId !== null) {
    clearTimeout(this.lastTimerId);
    this.lastTimerId = null;
  }
};

//////////////////////////////////////////////////////////////////////
// Utilities
//////////////////////////////////////////////////////////////////////
TestSuite.prototype.makePromise = function (fn) {
  var deferred = Q.defer();
  try {
    fn.call(this, function promiseDone(err) {
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
  this.clearLastTimeout();
  this.clearQueue(err, function() {

    var rejectWithError = this.fatalQueueError; // TODO: other reasons to reject?
    if (rejectWithError) {
      //this.client.handleException(rejectWithError); // TODO: redundant? Check when this is called before
      this.deferred.reject(rejectWithError);
    } else {
      this.deferred.resolve(this.testResults);
    }
    
  }.bind(this));
};

TestSuite.prototype.catchHandler = function(err) {
  if (this.currentCatchHandler) {
    this.currentCatchHandler(err);
  } else {
    this.complete(err);
  }
};

module.exports = TestSuite;
