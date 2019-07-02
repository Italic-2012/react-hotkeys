import removeAtIndex from '../../utils/array/removeAtIndex';
import KeyEventRecordManager from '../shared/KeyEventRecordManager';
import Configuration from '../config/Configuration';
import KeyCombinationSerializer from '../shared/KeyCombinationSerializer';
import isObject from '../../utils/object/isObject';
import hasKey from '../../utils/object/hasKey';
import arrayFrom from '../../utils/array/arrayFrom';
import isUndefined from '../../utils/isUndefined';
import KeyEventRecordIndex from '../../const/KeyEventRecordIndex';
import KeySequenceParser from '../shared/KeySequenceParser';
import KeyEventRecordState from '../../const/KeyEventRecordState';

/**
 * @typedef {Object} ComponentOptions a hotkeys component's options in a normalized
 *          format
 * @property {ActionDictionary} actions The dictionary of actions defined by the
 *           component
 */

/**
 * A mapping between ActionName and ActionConfiguration
 * @typedef {Object<ActionName,ActionConfiguration>} ActionDictionary
 */

/**
 * Standardized format for defining an action
 * @typedef {Object} ActionConfiguration
 * @property {NormalizedKeySequenceId} prefix - String describing the sequence of key
 *          combinations, before the final key combination (an empty string for
 *          sequences that are a single key combination)
 * @property {ActionName} actionName - Name of the action
 * @property {Number} sequenceLength - Number of combinations involved in the
 *           sequence
 * @property {KeyCombinationString} id - Serialized description of the key combinations
 *            that make up the sequence
 * @property {Object.<KeyName, Boolean>} keyDictionary - Dictionary of key names involved
 *           in the last key combination of the sequence
 * @property {KeyEventRecordIndex} eventRecordIndex - Record index for key event that
 *          the matcher should match on
 * @property {Number} size - Number of keys involved in the final key combination
 */

/**
 * List of component options that define the application's currently enabled key
 * maps and handlers, starting from the inner-most (most deeply nested) component,
 * that is closest to the DOM element currently in focus, and ending with the options
 * of the root hotkeys component.
 * @class
 */
class ComponentOptionsList {
  constructor() {
    /**
     * List of ComponentOptions for the actions registered by each hot keys component.
     * @type {ComponentOptions[]}
     */
    this._list = [];

    /**
     * Dictionary mapping the ids of the components defining actions, and their
     * position in the list.
     * @type {Object<ComponentId, Number>}
     */
    this._idToIndex = {};

    /**
     * Counter for the length of the longest sequence currently enabled.
     * @type {Number}
     */
    this._longestSequence = 1;

    /**
     * The id of the component with the longest key sequence
     * @type {ComponentId}
     */
    this._longestSequenceComponentId = null;

    /**
     * Record of whether at least one keymap is bound to each event type (keydown,
     * keypress or keyup)
     * @type {KeyEventRecord}
     */
    this._keyMapEventRecord = KeyEventRecordManager.newRecord();
  }

  /**
   * Adds a new hot key component's options, to be parsed and standardised before being
   * added to the list
   * @param {ComponentId} componentId - Id of the component the options belong to
   * @param {KeyMap} actionNameToKeyMap - Map of actions to key maps
   * @param {HandlersMap} actionNameToHandlersMap - Map of actions to handlers
   * @param {Object} options - Hash of options that configure how the key map is built.
   * @param {String} options.defaultKeyEvent - The default key event to use for any
   *        action that does not explicitly define one.
   * @returns {Number} The position the component options have in the list
   */
  add(componentId, actionNameToKeyMap, actionNameToHandlersMap, options) {
    if (this.containsId(componentId)) {
      return this.update(
        componentId, actionNameToKeyMap, actionNameToHandlersMap, options
      );
    }

    const componentOptions = this._build(
      componentId, actionNameToKeyMap, actionNameToHandlersMap, options
    );

    this._list.push(componentOptions);

    const newIndex = this._getLastIndex();
    return this._idToIndex[componentId] = newIndex;
  }

  /**
   * Whether the list contains options for a component with the specified id
   * @param {ComponentId} id Id of the component
   * @returns {boolean} True if the list contains options for the component with the
   *        specified id
   */
  containsId(id) {
    return !!this.get(id);
  }

  /**
   * Retrieves options for a component from the list
   * @param {ComponentId} id Id of the component to retrieve the options for
   * @returns {ComponentOptions} Options for the component with the specified id
   */
  get(id) {
    return this.getAtIndex(this.getIndexById(id));
  }

  /**
   * Returns the position of the options belonging to the component with the specified
   * id.
   * @param {ComponentId} id Id of the component to retrieve the options for
   * @returns {Number} The position of the component options in the list.
   */
  getIndexById(id) {
    return this._idToIndex[id];
  }

  /**
   * Replaces the options of a component already in the list with new values
   * @param {ComponentId} componentId - Id of the component to replace the options of
   * @param {KeyMap} actionNameToKeyMap - Map of actions to key maps
   * @param {HandlersMap} actionNameToHandlersMap - Map of actions to handlers
   * @param {Object} options - Hash of options that configure how the key map is built.
   * @param {String} options.defaultKeyEvent - The default key event to use for any
   *        action that does not explicitly define one.
   * @returns {Number} The position the component options have in the list
   */
  update(componentId, actionNameToKeyMap, actionNameToHandlersMap, options) {
    /**
     * We record whether we're building new options for the component that currently
     * has the longest sequence, to decide whether we need to recalculate the longest
     * sequence.
     */
    const isUpdatingLongestSequenceComponent =
      this._isUpdatingComponentWithLongestSequence(componentId);

    const longestSequenceBefore = this.getLongestSequence();

    const componentOptions = this._build(
      componentId, actionNameToKeyMap, actionNameToHandlersMap, options
    );

    if (isUpdatingLongestSequenceComponent &&
      componentOptions.sequenceLength !== longestSequenceBefore) {
      /**
       * Component with the longest sequence has just had new options registered
       * so we need to reset the longest sequence
       */
      if (componentOptions.sequenceLength > longestSequenceBefore) {
        /**
         * The same component has registered a longer sequence, so we just
         * need to update the sequence length to the new, larger number
         */
        this._longestSequence = componentOptions.sequenceLength;
      } else {
        /**
         * The component may no longer have the longest sequence, so we need to
         * recalculate
         */
        this._recalculateLongestSequence();
      }
    }

    this.updateAtIndex(this.getIndexById(componentId), componentOptions);
  }

  /**
   * Removes the options of a component from the list
   * @param {ComponentId} id The id of the component whose options are removed
   * @return {void}
   */
  remove(id) {
    const isUpdatingLongestSequenceComponent =
      this._isUpdatingComponentWithLongestSequence(id);

    this.removeAtIndex(this.getIndexById(id));

    if (isUpdatingLongestSequenceComponent) {
      this._recalculateLongestSequence();
    }
  }

  /**
   * Whether the list has any options in it (non-empty)
   * @returns {boolean} true if the list has one or more options in it
   */
  any() {
    return this.getLength() !== 0;
  }

  /**
   * Whether a component is the root component (the last one in the list)
   * @param {ComponentId} id Id of the component to query if it is the root
   * @returns {boolean} true if the component is the last in the list
   */
  isRoot(id) {
    return this.getIndexById(id) >= this.getLength() - 1;
  }

  /**
   * The length of the longest sequence currently defined.
   * @returns {Number} The sequence length
   */
  getLongestSequence() {
    return this._longestSequence;
  }

  /**
   * Whether the list contains at least one component with an action bound to a
   * particular keyboard event type.
   * @param {KeyEventRecordIndex} eventRecordIndex Index of the keyboard event type
   * @returns {boolean} true when the list contains a component with an action bound
   *          to the event type
   */
  anyActionsForEventType(eventRecordIndex) {
    return !!this._keyMapEventRecord[eventRecordIndex];
  }

  /**
   * The number of components in the list
   * @returns {Number} Number of components in the list
   */
  getLength() {
    return this._list.length;
  }

  forEach(iterator) {
    this._list.forEach(iterator);
  }

  getAtIndex(index) {
    return this._list[index];
  }

  updateAtIndex(index, componentOptions) {
    this._list[index] = componentOptions;
  }

  removeAtIndex(index) {
    this._list = removeAtIndex(this._list, index);

    let counter = index;

    while(counter < this.getLength()) {
      this._idToIndex[this.getAtIndex(counter).componentId] = counter;
      counter++;
    }
  }

  toJSON() {
    return this._list;
  }

  /**
   * Private
   */

  _getLastIndex() {
    return this.getLength() - 1;
  }

  /**
   * Builds the internal representation that described the options passed to a hot keys
   * component
   * @param {ComponentId} componentId - Id of the component the options belong to
   * @param {KeyMap} actionNameToKeyMap - Map of actions to key maps
   * @param {HandlersMap} actionNameToHandlersMap - Map of actions to handlers
   * @param {Object} options - Hash of options that configure how the key map is built.
   * @returns {ComponentOptions} Options for the specified component
   * @private
   */
  _build(componentId, actionNameToKeyMap, actionNameToHandlersMap, options){
    const { keyMap: hardSequenceKeyMap, handlers: includingHardSequenceHandlers } =
      this._applyHardSequences(actionNameToKeyMap, actionNameToHandlersMap);

    return {
      actions: this._buildActionDictionary(
        {
          ...actionNameToKeyMap,
          ...hardSequenceKeyMap
        },
        options,
        componentId
      ),
      handlers: includingHardSequenceHandlers,
      componentId,
      options
    };
  }

  _isUpdatingComponentWithLongestSequence(componentId) {
    return componentId === this._getLongestSequenceComponentId();
  }

  _getLongestSequenceComponentId() {
    return this._longestSequenceComponentId;
  }

  _recalculateLongestSequence() {
    this.forEach(({longestSequence, componentId }) => {
      if (longestSequence > this.getLongestSequence()) {
        this._longestSequenceComponentId = componentId;
        this._longestSequence = longestSequence;
      }
    });
  }

  /**
   * Applies hard sequences (handlers attached to actions with names that are valid
   * KeySequenceStrings) that implicitly define a corresponding action name.
   * @param {KeyMap} actionNameToKeyMap - KeyMap specified by HotKeys component
   * @param {HandlersMap} actionNameToHandlersMap - HandlersMap specified by HotKeys
   *        component
   * @returns {{keyMap: {}, handlers: {}}} Object containing keymap and handlers map
   *        with the hard sequence actions applied
   * @private
   */
  _applyHardSequences(actionNameToKeyMap, actionNameToHandlersMap) {
    if (Configuration.option('enableHardSequences')) {
      return Object.keys(actionNameToHandlersMap).reduce((memo, actionNameOrKeyExpression) => {
        const actionNameIsInKeyMap = !!actionNameToKeyMap[actionNameOrKeyExpression];

        if (!actionNameIsInKeyMap && KeyCombinationSerializer.isValidKeySerialization(actionNameOrKeyExpression)) {
          memo.keyMap[actionNameOrKeyExpression] = actionNameOrKeyExpression;
        }

        memo.handlers[actionNameOrKeyExpression] =
          actionNameToHandlersMap[actionNameOrKeyExpression];

        return memo;
      }, {keyMap: {}, handlers: {}});
    } else {
      return { keyMap: actionNameToKeyMap, handlers: actionNameToHandlersMap };
    }
  }

  /**
   * Returns a mapping between ActionNames and FullKeyEventOptions
   * @param {KeyMap} actionNameToKeyMap - Mapping of ActionNames to key sequences.
   * @param {Object} options - Hash of options that configure how the key map is built.
   * @param {String} options.defaultKeyEvent - The default key event to use for any
   *        action that does not explicitly define one.
   * @param {ComponentId} componentId Index of the component the matcher belongs to
   * @return {ActionDictionary} Map from ActionNames to FullKeyEventOptions
   * @private
   */
  _buildActionDictionary(actionNameToKeyMap, options, componentId) {
    return Object.keys(actionNameToKeyMap).reduce((memo, actionName) => {
      const keyMapConfig = actionNameToKeyMap[actionName];

      const keyMapOptions = function(){
        if (isObject(keyMapConfig) && hasKey(keyMapConfig, 'sequences')) {
          return arrayFrom(keyMapConfig.sequences)
        } else {
          return arrayFrom(keyMapConfig);
        }
      }();

      keyMapOptions.forEach((keyMapOption) => {
        const { keySequence, eventRecordIndex } = function(){
          if (isObject(keyMapOption)) {
            const { sequence, action } = keyMapOption;

            return {
              keySequence: sequence,
              eventRecordIndex: isUndefined(action) ? KeyEventRecordIndex[options.defaultKeyEvent] : KeyEventRecordIndex[action]
            };
          } else {
            return {
              keySequence: keyMapOption,
              eventRecordIndex: KeyEventRecordIndex[options.defaultKeyEvent]
            }
          }
        }();

        const { sequence, combination } = KeySequenceParser.parse(keySequence, { eventRecordIndex });

        if (sequence.size > this.getLongestSequence()) {
          this._longestSequence = sequence.size;
          this._longestSequenceComponentId = componentId;
        }

        /**
         * Record that there is at least one key sequence in the focus tree bound to
         * the keyboard event
         */
        this._keyMapEventRecord[eventRecordIndex] = KeyEventRecordState.seen;

        if (!memo[actionName]) {
          memo[actionName] = [];
        }

        memo[actionName].push({
          prefix: sequence.prefix,
          actionName,
          sequenceLength: sequence.size,
          ...combination,
        });
      });

      return memo;
    }, {});
  }
}

export default ComponentOptionsList;