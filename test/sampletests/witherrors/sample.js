module.exports = {

  'test1': function (browser) {
    browser.globals.errorTesting.runTest('test1', browser);
  },

  'test2': function (browser) {
    browser.globals.errorTesting.runTest('test2', browser);
  },

  before: function (browser, done) {
    browser.globals.errorTesting.runHook('suite', 'before', browser, done);
  },
  beforeEach: function (browser, done) {
    browser.globals.errorTesting.runHook('suite', 'beforeEach', browser, done);
  },
  afterEach: function (browser, done) {
    browser.globals.errorTesting.runHook('suite', 'afterEach', browser, done);
  },
  after: function (browser, done) {
    browser.globals.errorTesting.runHook('suite', 'after', browser, done);
  }
};