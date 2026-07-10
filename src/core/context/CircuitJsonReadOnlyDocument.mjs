/**
 * Freezes canonical document records while leaving binary views usable.
 */
export class CircuitJsonReadOnlyDocument {
    /**
     * Freezes one document and every nested plain object or array.
     * @param {Record<string, any>} document Canonical document envelope.
     * @returns {Record<string, any>} The same read-only envelope.
     */
    static freeze(document) {
        CircuitJsonReadOnlyDocument.#freezeValue(document, new Set())
        return document
    }

    /**
     * Freezes one clone-safe container in child-first order.
     * @param {unknown} value Candidate value.
     * @param {Set<object>} seen Visited object identities.
     * @returns {void}
     */
    static #freezeValue(value, seen) {
        if (!CircuitJsonReadOnlyDocument.#container(value)) return
        if (seen.has(value)) return
        seen.add(value)
        const children = Array.isArray(value) ? value : Object.values(value)
        for (const child of children) {
            CircuitJsonReadOnlyDocument.#freezeValue(child, seen)
        }
        Object.freeze(value)
    }

    /**
     * Returns true for containers that can be frozen without breaking views.
     * @param {unknown} value Candidate value.
     * @returns {boolean} Whether the value is a supported container.
     */
    static #container(value) {
        if (!value || typeof value !== 'object') return false
        if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
            return false
        }
        if (Array.isArray(value)) return true
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }
}
