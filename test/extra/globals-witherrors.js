module.exports = {
  asyncHookTimeout: 100,

  errorTesting: {
    errorTimeout: 50,
    output: true,
    history: [],

    // meta:
    contexts: ['global', 'suite', 'test'],
    names:    ['before', 'beforeEach', 'afterEach', 'after'], // only applies to 'global' and 'suite'
                                                              // 'test' is user-defined
    timings:  ['timeout', 'sync', 'async'],
    errors:   ['throw', 'assert', 'verify', 'expect', 'done'], // ignored for 'timeout'
                                                               // only 'throw' supported for global.before, global.after

    /* To determine what error to test:
    test: {
      context: 'global',
      hook:    'beforeEach',
      timing:  'async',
      error:   'throw'
    }
    */

    runHook: function (context, name, browser, done) {

      var isTestMatch = this.isTestMatch(context, name);
      this.errorLogging(context + '.' + name, isTestMatch);

      if (isTestMatch) {

        switch (this.test.timing) {
        case 'timeout':
          return;

        case 'sync':
          this.generateError(browser, done);
          return;

        case 'async':
          setTimeout(function(){
            this.generateError(browser, done);
          }.bind(this), this.errorTimeout);
          return;
        }
      }

      done();
    },

    runTest: function (name, browser) {

      var context = 'test';
      var isTestMatch = this.isTestMatch(context, name);
      this.errorLogging(context + '.' + name, isTestMatch);

      if (isTestMatch) {

        switch (this.test.timing) {
        case 'timeout':
          browser.perform(function(browser, done) {
            // TODO: test timeouts supported?
          });
          return;

        case 'sync':
          this.generateError(browser);
          return;

        case 'async':
          browser.perform(function(_browser, done) {
            setTimeout(function(){
              this.generateError(browser, done);
            }.bind(this), this.errorTimeout);
          }.bind(this));
          return;
        }
      }
    },

    isTestMatch: function (context, name) {
      if (!this.test || !context || !name) {
        return false;
      }

      if (context === this.test.context && name === this.test.name) {
        return true;
      }

      return false;
    },

    errorLogging: function (qualifiedName, isTestMatch) {

      this.history.push(qualifiedName);

      if (this.output) {

        var msg = ('=== In ' + qualifiedName).toUpperCase();
        if (isTestMatch) {
          msg += ' testing: ' + JSON.stringify(this.test);
        }
        console.log(msg);
      }
    },

    generateError: function(browser, done) {

      var testStr = JSON.stringify(this.test);
      var doneErr;

      switch (this.test.error) {
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