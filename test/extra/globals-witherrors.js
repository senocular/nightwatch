module.exports = {
  asyncHookTimeout: 100,

  errorTesting: {
    errorTimeout: 50,
    output: false,
    history: [], // list of full names of methods run in the test run, e.g. suite.beforeEach
    testcases: {}, // map of currentTest objects for each test case keyed by full name

    // meta:
    contexts: ['global', 'suite', 'test'],
    names:    ['before', 'beforeEach', 'afterEach', 'after'], // only applies to 'global' and 'suite'
                                                              // 'test' is user-defined
    timings:  ['timeout', 'sync', 'async'],
    errors:   ['throw', 'assert', 'verify', 'expect', 'done'], // ignored for 'timeout'
                                                               // only 'throw' supported for global.before, global.after

    /* To determine what error to test (array of these objects also works):
    test: {
      context: 'global',
      hook:    'beforeEach',
      timing:  'async',
      error:   'throw',
      count:   1 // when matches multiple, number of times to invoke an error
    }
    */

    runHook: function (context, name, browser, done) {

      var test = this.findMatchingTest(context, name);
      this.log(context, name, test);

      if (test) {

        switch (test.timing) {
        case 'timeout':
          return;

        case 'sync':
          this.generateError(test, browser, done);
          return;

        case 'async':
          setTimeout(function(){
            this.generateError(test, browser, done);
          }.bind(this), this.errorTimeout);
          return;
        }
      }

      done();
    },

    runTest: function (browser) {

      var currentTest = browser.currentTest;
      var context = currentTest.module;
      var name = currentTest.name;
      var test = this.findMatchingTest(context, name);
      this.log(context, name, test, currentTest);

      if (test) {

        switch (test.timing) {
        case 'timeout':
          browser.perform(function(browser, done) {
            // TODO: test timeouts supported? they hang indefinitely; expected?
          });
          return;

        case 'sync':
          this.generateError(test, browser);
          return;

        case 'async':
          browser.perform(function(_browser, done) {
            setTimeout(function(){
              this.generateError(test, browser, done);
            }.bind(this), this.errorTimeout);
          }.bind(this));
          return;
        }
      }
    },

    findMatchingTest: function (context, name) {

      var test = this.test;

      if (!test || !context || !name) {
        return false;
      }

      if (!Array.isArray(test)) {
        test = [test];
      }

      var matchingTests = test.filter(function(test){
        return this.findMatchingTestSingle(test, context, name);
      }.bind(this));

      return matchingTests.length > 0 ? matchingTests[0] : null;
    },

    findMatchingTestSingle: function (test, context, name) {

      if (!test) {
        return false;
      }

      if (test.count === 0) {
        return false;
      }

      if (context === test.context && name === test.name) {

        if (test.count && test.count > 0) {
          var fullName = this.getFullName(context, name);
          var occurs = this.history.filter(function(name) { return name === fullName; }).length;
          if (occurs >= test.count) {
            return false;
          }
        }

        return true;
      }

      return false;
    },

    log: function (context, name, test, currentTest) {

      var fullName = this.getFullName(context, name);
      this.history.push(fullName);

      if (currentTest) {
        this.testcases[fullName] = currentTest;
      }

      if (this.output) {

        var msg = ('=== @ ' + fullName);
        if (test) {
          msg += ' Matches: ' + JSON.stringify(test);
        }
        console.log(msg);
      }
    },

    getFullName: function(context, name) {
      return context + '.' + name;
    },

    generateError: function(test, browser, done) {

      var testStr = JSON.stringify(test);
      var doneErr;

      switch (test.error) {
      case 'throw':
        throw new Error('Message thrown for ' + testStr + '.');

      case 'assert':
        if (browser) {
          browser.assert.ok(false, 'Assertion failure for ' + testStr + '.');
        }
        break;

      case 'verify':
        if (browser) {
          browser.assert.ok(false, 'Verify failure for ' + testStr + '.');
        }
        break;

      case 'expect':
        if (browser) {
          browser.expect.element('#does-not-exist').to.be.present.before(1);
        }
        break;

      case 'done':
        doneErr = new Error('Message passed to done for ' + testStr + '.');
        break;
      }

      if (done) {
        if (doneErr) {
          done(doneErr);
        } else {
          done();
        }
      }

    }
  },

  before: function (done) {
    this.errorTesting.runHook('global', 'before', null, done);
  },
  beforeEach: function (browser, done) {
    this.errorTesting.runHook('global', 'beforeEach', browser, done);
  },
  afterEach: function (browser, done) {
    this.errorTesting.runHook('global', 'afterEach', browser, done);
  },
  after: function (done) {
    this.errorTesting.runHook('global', 'after', null, done);
  }
};