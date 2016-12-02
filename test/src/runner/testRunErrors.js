var assert = require('assert');
var mockery = require('mockery');
var CommandGlobals = require('../../lib/globals/commands.js');
var MockSuiteRunner = require('../../lib/mocksuiterunner.js');

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
      new MockSuiteRunner(testSuite, {
          globals:globals
        },
        null,
        function () {
          assert(beforeEachReached, 'global beforeEach reached');
          assert(afterEachReached, 'global afterEach reached');
          assert(!unexpectedReached, 'suite hooks or test not reached');
          // TODO: check results
      }).run(done);
    },

    // TODO:
    '!!! possibly runner resolve problems in master': !function (done) {
      var odone = done;
      done = function(){
        console.log('UNIT DONE') // TODO: remove odone wrapper
        odone.apply(null, arguments)
      }

      var testAReached = false;
      var testBReached = false;
      var testSuites = [{
          testA: function (browser) {
            console.log('TEST A')
            browser.assert.ok(false, 'testA sync fail');
            testAReached = true;
            throw new Error('hi')
          }
        }, {
          testB: function () {
            console.log('TEST B')
            testBReached = true;
          }
        }
      ];
      
      new MockSuiteRunner(testSuites, {
          skip_testcases_on_fail: true
        },
        null,
        function (err, results) {
          console.log('RUN RESULTS');
          assert(testAReached, 'testA reached');
          assert(testBReached, 'testB reached');
          // TODO: check results
          results;
      }).run(done);
    },

    'synchronous asserts respect skip_testcases_on_fail': function (done) {
      var testAReached = false;
      var testBReached = false;

      var testSuite = {
        testA: function (browser) {
          browser.assert.ok(false);
          testAReached = true;
        },
        testB: function () {
          testBReached = true;
        }
      };
      
      new MockSuiteRunner(testSuite, {
          skip_testcases_on_fail: true
        },
        null,
        function (err, results) {
          console.log('RUN RESULTS');
          assert(testAReached, 'testA reached');
          assert(!testBReached, 'testB reached');
          // TODO: check results
          results;
      }).run(done);
    },



  }
};

