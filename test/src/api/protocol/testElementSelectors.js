var assert = require('assert');
var MochaTest = require('../../../lib/mochatest.js');
var Nightwatch = require('../../../lib/nightwatch.js');
var MockServer  = require('../../../lib/mockserver.js');

module.exports = MochaTest.add('element selectors', {

  beforeEach: function (done) {

    // TODO: use nocks
    MockServer
      .addMock({
        url: '/wd/hub/session/1352110219202/element',
        postdata : '{"using":"css selector","value":"#id"}',
        method: 'POST',
        response: JSON.stringify({
          status: 0,
          state: 'success',
          value: {ELEMENT: '1'}
        })
      })
      .addMock({
        url: '/wd/hub/session/1352110219202/elements',
        postdata : '{"using":"css selector","value":"#id"}',
        method: 'POST',
        response: JSON.stringify({
          status: 0,
          state: 'success',
          value: [{ELEMENT: '1'}]
        })
      })
      .addMock({
        url: '/wd/hub/session/1352110219202/elements',
        postdata : '{"using":"css selector","value":".classname"}',
        method: 'POST',
        response: JSON.stringify({
          status: 0,
          state: 'success',
          value: [{ELEMENT: '2'},{ELEMENT: '3'},{ELEMENT: '4'}]
        })
      });

    Nightwatch.init({}, done);
  },

  'basic selector objects in element()' : function(done) {

    Nightwatch.api()
      .element('css selector', {selector: '#id'}, function callback(result) {
        assert.equal(result.value.ELEMENT, '1', 'Found element id for #id');
      })
      .element('css selector', {selector: '.doesnotexist'}, function callback(result) {
        assert.equal(result.status, -1, 'Not found for .doesnotexist');
      })
      .perform(function() {
        done();
      });

    Nightwatch.start();
  },

  'null selector error in element()' : function(done) {
    // TODO: validate null selector behavior
    catchQueueError(function (err) {
      var msg = 'No selector property for element';
      assert.equal(err.message.slice(0, msg.length), msg);
      done();
    });

    Nightwatch.api()
      .element('css selector', null, function callback(result) {
        assert.ok(false, 'Null selector object should fail');
      });

    Nightwatch.start();
  },

  'empty selector error in element()' : function(done) {
    catchQueueError(function (err) {
      var msg = 'No selector property for element';
      assert.equal(err.message.slice(0, msg.length), msg);
      done();
    });

    Nightwatch.api()
      .element('css selector', {}, function callback(result) {
        assert.ok(false, 'Empty selector object should fail');
      });

    Nightwatch.start();
  },

  'basic selector objects in elements()' : function(done) {
    Nightwatch.api()
      .elements('css selector', {selector: '#id'}, function callback(result) {
        assert.equal(result.value[0].ELEMENT, '1', 'Found element id for #id');
      })
      .elements('css selector', {selector: '.doesnotexist'}, function callback(result) {
        assert.equal(result.status, -1, 'Not found for .doesnotexist');
      })
      .perform(function() {
        done();
      });

    Nightwatch.start();
  },

  'null selector error in elements()' : function(done) {
    catchQueueError(function (err) {
      var msg = 'No selector property for element';
      assert.equal(err.message.slice(0, msg.length), msg);
      done();
    });

    Nightwatch.api()
      .elements('css selector', null, function callback(result) {
        assert.ok(false, 'Null selector object should fail');
      });

    Nightwatch.start();
  },

  'empty selector error in elements()' : function(done) {
    catchQueueError(function (err) {
      var msg = 'No selector property for element';
      assert.equal(err.message.slice(0, msg.length), msg);
      done();
    });

    Nightwatch.api()
      .elements('css selector', {}, function callback(result) {
        assert.ok(false, 'Empty selector object should fail');
      });

    Nightwatch.start();
  },

  'selector objects with locateStrategy' : function(done) {
    Nightwatch.api()
      .elements('css selector', {selector: '#id', locateStrategy: 'css selector'}, function callback(result) {
        assert.equal(result.value[0].ELEMENT, '1', 'Found element id, same locateStrategy');
      })
      .elements('xpath', {selector: '#id', locateStrategy: 'css selector'}, function callback(result) {
        assert.equal(result.value[0].ELEMENT, '1', 'Found element id, overridden locateStrategy');
      })
      .elements('css selector', {selector: '#id', locateStrategy: null}, function callback(result) {
        assert.equal(result.value[0].ELEMENT, '1', 'Found element id, null locateStrategy');
      })
      .perform(function() {
        done();
      });

    Nightwatch.start();
  },

  'selector error with only locateStrategy' : function(done) {
    catchQueueError(function (err) {
      var msg = 'No selector property for element';
      assert.equal(err.message.slice(0, msg.length), msg);
      done();
    });

    Nightwatch.api()
      .elements('css selector', {locateStrategy: 'css selector'}, function callback(result) {
        assert.ok(false, 'Selector with locateStrategy should fail');
      });

    Nightwatch.start();
  },

  'selector objects with index' : function(done) {
    Nightwatch.api()
      .elements('css selector', {selector: '#id', index: 0}, function callback(result) {
        assert.equal(result.value[0].ELEMENT, '1', 'Found element id, 0 index');
      })
      .elements('css selector', {selector: '.classname', index: 1}, function callback(result) {
        assert.equal(result.value[0].ELEMENT, '3', 'Found element id, 1 index');
      })
      .elements('css selector', {selector: '.classname', index: 2}, function callback(result) {
        assert.equal(result.value[0].ELEMENT, '4', 'Found element id, 2 index');
      })
      .elements('css selector', {selector: '.classname', index: 999}, function callback(result) {
        // TODO: remove state success?
        assert.equal(result.status, -1, 'Not found for out of range index');
      })
      .perform(function() {
        done();
      });

    Nightwatch.start();
  }

  // TODO: test with page objects/recursion
  
});

/**
 * Monkey-patch run queue run() callbacks to capture errors handled
 * in the queue after they are sent off to the nightwatch instance.
 */
function catchQueueError(testCallback) {
  var queue = Nightwatch.client().queue;

  // queue is a singleton, not re-instancing with new nightwatch
  // instances. In order to re-patch it if patched previously, we
  // restore the original run method from the patch if it exists
  // (which may happen if a patched run never gets called with err)

  if (queue.run.origRun) {
    queue.run = queue.run.origRun;
  }

  function queueRunnerPatch (origCallback) {
    origRun.call(queue, function(err) {
      origCallback(err);
      if (err) {
        queue.run = origRun; // once
        testCallback(err);
      }
    });
  }

  var origRun = queueRunnerPatch.origRun = queue.run;
  queue.run = queueRunnerPatch;
}
