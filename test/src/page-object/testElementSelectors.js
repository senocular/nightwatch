var path = require('path');
var assert = require('assert');
var common = require('../../common.js');
var Api = common.require('core/api.js');
var utils = require('../../lib/utils.js');
var nocks = require('../../lib/nockselements.js');
var MochaTest = require('../../lib/mochatest.js');
var Nightwatch = require('../../lib/nightwatch.js');

module.exports = MochaTest.add('test element selectors', {

  beforeEach: function (done) {
    Nightwatch.init({
      page_objects_path: [path.join(__dirname, '../../extra/pageobjects')]
    }, done);
  },

  afterEach: function () {
    nocks.cleanAll();
  },

  'page elements' : function(done) {
    nocks
      .elementsFound('#weblogin')
      .elementsByXpath('//weblogin')
      .elementsByXpath('#weblogin', [])
      .text(0, 'first')
      .text(1, 'second');

    var client = Nightwatch.client();
    Api.init(client);

    var page = client.api.page.simplePageObj();

    page
      .getText('@loginAsString', function callback(result) {
        assert.equal(result.status, 0, 'element selector string found');
        assert.equal(result.value, 'first', 'element selector string value');
      })
      .getText({selector: '@loginAsString'}, function callback(result) {
        assert.equal(result.status, 0, 'element selector property found');
        assert.equal(result.value, 'first', 'element selector property value');
      })
      .getText('@loginXpath', function callback(result) {
        assert.equal(result.status, 0, 'element selector xpath found');
        assert.equal(result.value, 'first', 'element selector xpath value');
      })
      .getText('@loginCss', function callback(result) {
        assert.equal(result.status, 0, 'element selector css found');
        assert.equal(result.value, 'first', 'element selector css value');
      })
      .getText('@loginIndexed', function callback(result) {
        assert.equal(result.status, 0, 'element indexed found');
        assert.equal(result.value, 'second', 'element indexed value');
      })
      .getText({selector:'@loginIndexed', index:0}, function callback(result) {
        assert.equal(result.status, 0, 'element indexed overridden found');
        assert.equal(result.value, 'first', 'element indexed overridden value');
      })
      .getText({selector:'@loginCss', locateStrategy:'xpath'}, function callback(result) {
        assert.equal(result.status, -1, 'element selector css xpath override not found');
      })
      .getText({selector:'@loginCss', index: 1}, function callback(result) {
        assert.equal(result.status, 0, 'element selector index 1 found');
        assert.equal(result.value, 'second', 'element selector index 1 value');
      })
      .getText({selector:'@loginCss', index: 999}, function callback(result) {
        assert.equal(result.status, -1, 'element selector index out of bounds not found');
      })
      .api.perform(function() {
        done();
      });

    Nightwatch.start();
  },

  'page section elements' : function(done) {
    nocks
      .elementsFound('#signupSection', [{ELEMENT: '0'}])
      .elementsFound('#getStarted', [{ELEMENT: '0'}])
      .elementsFound('#helpBtn')
      .elementsId(0, '#helpBtn', [], 'xpath')
      .elementsId(0, '#helpBtn')
      .text(0, 'first')
      .text(1, 'second');

    var client = Nightwatch.client();
    Api.init(client);

    var page = client.api.page.simplePageObj();
    var section = page.section.signUp;
    var sectionChild = section.section.getStarted;

    section
      .getText('@help', function callback(result) {
        assert.equal(result.status, 0, 'section element selector string found');
        assert.equal(result.value, 'first', 'section element selector string value');
      })
      .getText({selector: '@help'}, function callback(result) {
        assert.equal(result.status, 0, 'section element selector property found');
        assert.equal(result.value, 'first', 'section element selector property value');
      })
      .getText({selector:'@help', locateStrategy:'xpath'}, function callback(result) {
        assert.equal(result.status, -1, 'section element selector css xpath override not found');
      })
      .getText({selector:'@help', index: 1}, function callback(result) {
        assert.equal(result.status, 0, 'section element selector index 1 found');
        assert.equal(result.value, 'second', 'section element selector index 1 value');
      })
      .getText({selector:'@help', index: 999}, function callback(result) {
        assert.equal(result.status, -1, 'section element selector index out of bounds not found');
      });

    sectionChild
      .getText('#helpBtn', function callback(result) {
        assert.equal(result.status, 0, 'child section element selector string found');
        assert.equal(result.value, 'first', 'child section element selector string value');
      })
      .getText({selector: '#helpBtn'}, function callback(result) {
        assert.equal(result.status, 0, 'child section element selector property found');
        assert.equal(result.value, 'first', 'child section element selector property value');
      })
      .getText({selector:'#helpBtn', index: 1}, function callback(result) {
        assert.equal(result.status, 0, 'child section element selector index 1 found');
        assert.equal(result.value, 'second', 'child section element selector index 1 value');
      })
      .api.perform(function() {
        done();
      });

    Nightwatch.start();
  }

});
