var nock = require('nock');

/**
 * More granular nocks definitions for element apis
 */
module.exports = {

  _requestUri: 'http://localhost:10195',
  _protocolUri: '/wd/hub/session/1352110219202/',

  elementFound : function(selector) {
    nock(this._requestUri)
      .persist()
      .post(this._protocolUri + 'element', {'using':'css selector','value':selector || '#nock'})
      .reply(200, {
        status: 0,
        state: 'success',
        value: { ELEMENT: '0' }
      });
    return this;
  },

  elementNotFound : function(selector) {
    nock(this._requestUri)
      .persist()
      .post(this._protocolUri + 'element', {'using':'css selector','value':selector || '#nock-none'})
      .reply(200, {
        status: -1,
        value: {},
        errorStatus: 7,
        error: 'An element could not be located on the page using the given search parameters.'
      });
    return this;
  },

  elementsFound : function(selector, foundArray) {
    nock(this._requestUri)
      .persist()
      .post(this._protocolUri + 'elements', {'using':'css selector','value':selector || '.nock'})
      .reply(200, {
        status: 0,
        state: 'success',
        value: foundArray || [ { ELEMENT: '0' }, { ELEMENT: '1' }, { ELEMENT: '2' } ]
      });
    return this;
  },

  elementsNotFound : function(selector) {
    nock(this._requestUri)
      .persist()
      .post(this._protocolUri + 'elements', {'using':'css selector','value':selector || '.nock-none'})
      .reply(200, {
        status: 0,
        state: 'success',
        value: []
      });
    return this;
  },

  elementsByTag : function(selector, foundArray) {
    nock(this._requestUri)
      .persist()
      .post(this._protocolUri + 'elements', {'using':'tag name','value':selector || 'nock'})
      .reply(200, {
        status: 0,
        state: 'success',
        value: foundArray || [ { ELEMENT: '0' }, { ELEMENT: '1' }, { ELEMENT: '2' } ]
      });
    return this;
  },

  elementsByXpath : function(selector, foundArray) {
    nock(this._requestUri)
      .persist()
      .post(this._protocolUri + 'elements', {'using':'xpath','value':selector || '//[@class="nock"]'})
      .reply(200, {
        status: 0,
        state: 'success',
        value: foundArray || [ { ELEMENT: '0' }, { ELEMENT: '1' }, { ELEMENT: '2' } ]
      });
    return this;
  },

  elementsId : function (id, selector, foundArray, using) {
    nock(this._requestUri)
      .persist()
      .post(this._protocolUri + 'element/' + (id || 0) + '/elements',
        {'using':using || 'css selector','value':selector || '.nock'})
      .reply(200, {
        status: 0,
        state : 'success',
        value: foundArray || [ { ELEMENT: '0' }, { ELEMENT: '1' }, { ELEMENT: '2' } ]
      });
    return this;
  },

  text : function (id, value) {
    nock(this._requestUri)
      .persist()
      .get(this._protocolUri + 'element/' + (id || 0) + '/text')
      .reply(200, {
        status: 0,
        state : 'success',
        value: value || 'textValue'
      });
    return this;
  },

  cleanAll: function () {
    nock.cleanAll();
  }
};