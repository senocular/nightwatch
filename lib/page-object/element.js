/**
 * Class that all elements subclass from
 *
 * @param {Object} options Element options defined in page object
 * @constructor
 */
function Element(options) {
  this.parent = options.parent;
  this.name = options.name || '(anonymous)';

  if (!options.selector) {
    throw new Error('No selector property for element "' + this.name +
      '" Instead found properties: ' + Object.keys(options));
  }

  this.selector = options.selector;
  this.locateStrategy = options.locateStrategy;
  this.index = options.index;
}

Element.prototype.toString = function() {
  return 'Element[name=@' + this.name + ']';
};

/**
 * Determines whether or not the element contians an @ element reference
 * for its selector.
 * @returns {boolean} True if the selector is an element reference starting with an 
 *    @ symbol, false if it does not.
 */
Element.prototype.hasElementSelector = function() {
  return String(this.selector)[0] === '@';
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

  // TODO: error on invalid selector specification?

  // if the selector value is already an element, return
  // it directly without additional parsing

  if (value instanceof Element) {
    value.locateStrategy = value.locateStrategy || using;
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

    element.selector = value[0];

    if (value.length > 1) {
      element.index = value[1];
    }

    if (value.length > 2) {
      element.using = value[2];
    }

  // object value format:
  // { selector: 'div', index (opt): 0, locateStrategy (opt): 'css selector' }

  } else if (typeof value === 'object') {

    element.selector = value.selector;

    if ('locateStrategy' in value) {
      element.locateStrategy = value.locateStrategy;
    }

    if ('index' in value) {
      element.index = value.index;
    }

  // default string value format as selector:
  // '#my-id div.my-class'

  } else {
    element.selector = String(value);
  }

  return element;
};

module.exports = Element;
