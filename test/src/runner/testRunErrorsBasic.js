var assert = require('assert');
var mockery = require('mockery');
var CommandGlobals = require('../../lib/globals/commands.js');
var MockSuiteRunner = require('../../lib/mocksuiterunner.js');

var failTypes = {

  failures: { // basic failure
    verifyOk: function (browser, done) { // sync
      browser.verify.ok(false);
      postFail(browser, done);
    },
    verifyOkInQueueCallback: function (browser, done) {
      browser.pause(1, function(){
        browser.verify.ok(false);
        postFail(browser, done);
      })
    },
    verifyElement: function (browser, done) {
      browser.verify.elementPresent('#does-not-exist');
      postFail(browser, done);
    }
  },

  failuresWithAbort: { // fails, also aborts command queue
    expectElement: function (browser) {
      browser.expect.element('#does-not-exist').to.be.present;
      postFail(browser);
    },
    assertElement: function (browser) {
      browser.assert.elementPresent('#does-not-exist');
      postFail(browser);
    },
    assertOk: function (browser) { // sync
      browser.assert.ok(false);
      postFail(browser);
    },
    assertOkInQueueCallback: function (browser) {
      browser.pause(1, function(){
        browser.assert.ok(false);
        postFail(browser);
      })
    },
    syncDone: function (browser, done) {
      done(new Error('Test error'));
      postFail(browser);
    },
    asyncDone: function (browser, done) {
      // no command queue required (using done is)
      setTimeout(function() {
        done(new Error('Test error'));
      }, 10);
    },
    asyncDoneUsingQueue: function (browser, done) {
      browser.element('id', 'does-not-exist', function () {
        done(new Error('Test error'));
      });
      postFail(browser);
    }
  },

  errors: { // fails, aborts command queue, aborts remaining test cases
    syncThrow: function (browser) {
      postFail(browser);
      throw new Error('Test error');
    },
    asyncThrowInQueueCommand: function (browser) {
      // sync perform()s are sync to queue runCommand() where error is handled
      browser.perform(function () {
        throw new Error('Test error');
      });
      postFail(browser);
    },
    asyncThrowUsingQueue: function (browser) {
      // thrown in HttpRequest.on('result') handler where error is uncaught
      browser.element('id', 'does-not-exist', function () {
        throw new Error('Test error');
      });
      postFail(browser);
    },
    asyncThrowUsingDone: function () {
      // no command queue required (using done is), error is uncaught
      setTimeout(function() {
        throw new Error('Test error');
      }, 10);
    }
    // + timeout error, handled separately
  }
};

function postFail (browser, done) {
  if (!browser) {
    if (done) {
      done();
    }
    return;
  }
  // something to check to see if fail aborted queue
  browser.perform(function () {
    browser.assert.ok(true, 'present if queue not terminated');
    if (done) {
      done();
    }
  });
}

module.exports = {
  'basic error handling': {
    before: function (done) {
      CommandGlobals.beforeEach.call(this, done);
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
    after: function (done) {
      CommandGlobals.afterEach.call(this, done);
    },

    'global.beforeEach failures': function (done) {
      var globals = {
        beforeEach: function (browser, done) {
          failTypes.failures.assertOk(browser, done);
        }
      };
      var testSuite = {
        test: function(){}
      };
      new MockSuiteRunner(testSuite, {
          globals:globals
        },
        null,
        function (err, results) {
          // TODO: validate results
          console.log('results:::', results);
          console.log('MockedSuite_0:::', results.modules.MockedSuite_0.completed);
      }).run(done);
    },
  }
};