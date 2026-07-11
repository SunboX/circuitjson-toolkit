const OWNED_PARSER_INPUTS = new WeakSet()
const OWNED_PROJECT_ENTRIES = new WeakSet()

/**
 * Marks structured-cloned worker inputs that already belong to the receiver.
 */
export class AsyncInputOwnership {
    /**
     * Marks one worker-received parser input as receiver-owned.
     * @param {object} input Parser input.
     * @returns {object} The same input.
     */
    static markParser(input) {
        if (input && typeof input === 'object') OWNED_PARSER_INPUTS.add(input)
        return input
    }

    /**
     * Returns whether one parser input already belongs to this process.
     * @param {unknown} input Parser input candidate.
     * @returns {boolean} Whether the input is receiver-owned.
     */
    static ownsParser(input) {
        return Boolean(
            input && typeof input === 'object' && OWNED_PARSER_INPUTS.has(input)
        )
    }

    /**
     * Marks one worker-received project entry array as receiver-owned.
     * @param {object[]} entries Project entries.
     * @returns {object[]} The same entries.
     */
    static markProject(entries) {
        if (entries && typeof entries === 'object') {
            OWNED_PROJECT_ENTRIES.add(entries)
        }
        return entries
    }

    /**
     * Returns whether project entries already belong to this process.
     * @param {unknown} entries Project entry candidate.
     * @returns {boolean} Whether the entries are receiver-owned.
     */
    static ownsProject(entries) {
        return Boolean(
            entries &&
            typeof entries === 'object' &&
            OWNED_PROJECT_ENTRIES.has(entries)
        )
    }
}

Object.freeze(AsyncInputOwnership.prototype)
Object.freeze(AsyncInputOwnership)
