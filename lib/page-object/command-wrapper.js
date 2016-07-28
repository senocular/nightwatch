var Element = require('./element.js');

module.exports = new (function() {

  /**
   * Given an element name, returns that element object
   *
   * @param {Object} parent The parent page or section
   * @param {string} elementName Name of element
   * @returns {Object} The element object
   */
  function getElement(parent, elementName) {
    elementName = elementName.substring(1);
    if (!(elementName in parent.elements)) {
      throw new Error(elementName + ' was not found in "' + parent.name +
        '". Available elements: ' + Object.keys(parent.elements));
    }
    return parent.elements[elementName];
  }

  /**
   * Given a section name, returns that section object
   *
   * @param {Object} parent The parent page or section
   * @param {string} sectionName Name of section
   * @returns {Object} The section object
   */
  function getSection(parent, sectionName) {
    sectionName = sectionName.substring(1);
    if (!(sectionName in parent.section)) {
      throw new Error(sectionName + ' was not found in "' + parent.name +
        '". Available sections: ' + Object.keys(parent.sections));
    }
    return parent.section[sectionName];
  }

  /**
   * Creates a closure that enables calling commands and assertions on the page or section.
   * For all element commands and assertions, it fetches element's selector and locate strategy
   *  For elements nested under sections, it sets 'recursion' as the locate strategy and passes as its first argument to the command an array of its ancestors + self
   *  If the command or assertion is not on an element, it calls it with the untouched passed arguments
   *
   * @param {Object} parent The parent page or section
   * @param {function} commandFn The actual command function
   * @param {string} commandName The name of the command ("click", "containsText", etc)
   * @param {Boolean} [isChaiAssertion]
   * @returns {parent}
   */
  function makeWrappedCommand(parent, commandFn, commandName, isChaiAssertion) {
    return function() {
      var args = Array.prototype.slice.call(arguments);

      // check the first argument for an element selector (using @ prefix). The only pattern
      // supported for element selectors is when they're used as the first argument.

      var inputElement = Element.fromSelector(args[0]);
      if (inputElement.hasElementSelector()) {

        // find the element definition the element selector references

        var getter = (isChaiAssertion && commandName === 'section') ? getSection : getElement;
        var elementOrSection = getter(parent, inputElement.selector);

        // copy over the reference's selector (replacing the @ - value) and
        // copy over any other defaults from the refernce if not defined
        // in the input element

        inputElement.selector = elementOrSection.selector;
        Element.copyDefaults(inputElement, elementOrSection);

        // check to see if the found element has ancestors that would
        // require a recursive query to locate.  If so, a new element
        // object is created to wrap the ancestors (which includes the
        // starting element) with the recursive locate strategy

        var ancestors = getAncestorsWithElement(inputElement);

        if (ancestors.length > 1) {
          inputElement = new Element({
            selector: ancestors,
            locateStrategy: 'recursion'
          });
        }

        // the resolved element gets sent back into args array to
        // be handed off to the actual command call

        args[0] = inputElement;
      }

      var result = commandFn.apply(parent.client, args);
      return (isChaiAssertion ? result : parent);
    };
  }

  /**
   * Retrieves an array of ancestors of the supplied element. The last element in the array is the element object itself
   *
   * @param {Object} element The element
   * @returns {Array}
   */
  function getAncestorsWithElement(element) {
    var elements = [];
    function addElement(e) {
      elements.unshift(e);
      if (e.parent && e.parent.selector) {
        addElement(e.parent);
      }
    }
    addElement(element);
    return elements;
  }

  /**
   * Adds commands (elements commands, assertions, etc) to the page or section
   *
   * @param {Object} parent The parent page or section
   * @param {Object} target What the command is added to (parent|section or assertion object on parent|section)
   * @param {Object} commands
   * @returns {null}
   */
  function applyCommandsToTarget(parent, target, commands) {

    Object.keys(commands).forEach(function(commandName) {
      if (isValidAssertion(commandName)) {
        target[commandName] = target[commandName] || {};

        var isChaiAssertion = commandName === 'expect';
        var assertions = commands[commandName];

        Object.keys(assertions).forEach(function(assertionName) {
          target[commandName][assertionName] = addCommand(target[commandName], assertions[assertionName], assertionName, parent, isChaiAssertion);
        });
      } else {
        target[commandName] = addCommand(target, commands[commandName], commandName, parent, false);
      }
    });
  }

  function addCommand(target, commandFn, commandName, parent, isChaiAssertion) {
    if (target[commandName]) {
      parent.client.results.errors++;
      var error = new Error('The command "' + commandName + '" is already defined!');
      parent.client.errors.push(error.stack);
      throw error;
    }

    return makeWrappedCommand(parent, commandFn, commandName, isChaiAssertion);
  }

  function isValidAssertion(commandName) {
    return ['assert', 'verify', 'expect'].indexOf(commandName) > -1;
  }

  /**
   * Entrypoint to add commands (elements commands, assertions, etc) to the page or section
   *
   * @param {Object} parent The parent page or section
   * @param {function} commandLoader function that retrieves commands
   * @returns {null}
   */
  this.addWrappedCommands = function (parent, commandLoader) {
    var commands = {};
    commands = commandLoader(commands);
    applyCommandsToTarget(parent, parent, commands);
  };

})();
