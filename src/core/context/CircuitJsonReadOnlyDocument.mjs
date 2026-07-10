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
        CircuitJsonReadOnlyDocument.#protectAssetData(document?.assets)
        CircuitJsonReadOnlyDocument.#freezeValue(document, new Set())
        return document
    }

    /**
     * Replaces binary asset values with defensive-copy accessors.
     * @param {unknown} assets Canonical asset array candidate.
     * @returns {void}
     */
    static #protectAssetData(assets) {
        if (!Array.isArray(assets)) return
        for (const asset of assets) {
            if (!asset || typeof asset !== 'object') continue
            if (Object.isFrozen(asset) || !ArrayBuffer.isView(asset.data)) {
                continue
            }
            const bytes = new Uint8Array(
                asset.data.buffer,
                asset.data.byteOffset,
                asset.data.byteLength
            ).slice()
            /** @returns {Uint8Array} A defensive payload copy. */
            const readAssetData = () => new Uint8Array(bytes)
            Object.defineProperty(asset, 'data', {
                configurable: false,
                enumerable: true,
                get: readAssetData
            })
        }
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

Object.freeze(CircuitJsonReadOnlyDocument.prototype)
Object.freeze(CircuitJsonReadOnlyDocument)
