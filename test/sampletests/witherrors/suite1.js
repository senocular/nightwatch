module.exports = {

  'testcase1': function (browser) {
    browser.globals.errorTesting.runTest(browser);
  },

  'testcase2': function (browser) {
    browser.globals.errorTesting.runTest(browser);
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