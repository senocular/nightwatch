/**
 * Class that all elements subclass from
 *
 * @param {Object} options Element options defined in page object
 * @constructor
 */
function Element(options) {
  this.parent = options.parent;
  this.name = options.name || 'anonymous';

  if (!options.selector) {
    throw new Error('No selector property for element "' + this.name +
      '" Instead found properties: ' + Object.keys(options));
  }

  this.selector = options.selector;
  this.locateStrategy = options.locateStrategy || 'css selector';
  this.index = options.index || 0;
}

Element.prototype.toString = function() {
  return 'Element[name=@' + this.name + ']';
};

/**
 * Parses the value/selector parameter of an element command creating a
 * new Element instance with the values it contains, if any. The standard
 * format for this is a selector string, but additional, complex formats
 * in the form of an array or object are also supported, allowing you to also
 * specify a locate strategy (using) and/or an element index for targeting
 * a specific element in a query that matches multiple.
 *
 * @param {string|Object} value Selector value to parse into an Element.
 * @param {string} [using] The using/locateStrategy to use if the selector
 *    doesn't provide one of its own.
 */
Element.fromSelector = function(value, using) {

  if (value instanceof Element) {
    return value;
  }

  var element = new Element({
    locateStrategy: using,
    selector: value
  });

  // recursion values don't get parsed here. They're an array of values
  // which get parsed individually in the recursive search process

  if (element.locateStrategy === 'recursion') {
    return element;
  }

  // array value format:
  // [value, index (opt), using (opt)]

  if (Array.isArray(value)) {

    element.value = value[0];

    if (value.length > 1) {
      element.index = parseInt(value[1], 10);
    }

    if (value.length > 2) {
      element.using = String(value[2]);
    }

  // object value format:
  // { selector: 'div', index (opt): 0, locateStrategy (opt): 'css selector' }

  } else if (typeof value === 'object') {

    element.value = value.selector;

    if ('locateStrategy' in value) {
      element.using = String(value.locateStrategy);
    }

    if ('index' in value) {
      element.index = parseInt(value.index, 10);
    }

  // default string value format as selector:
  // '#my-id div.my-class'

  } else {
    element.value = String(value);
  }

  return element;
};

Element.isElementSelector = function(value) {
  var element = Element.fromSelector(value);
  return String(element.selector)[0] === '@';
};

module.exports = Element;
