import { CircuitJsonIndexer } from '../CircuitJsonIndexer.mjs'
import { CircuitJsonValidationProof } from './CircuitJsonValidationProof.mjs'

const INDEX_NAMES = new Set([
    'elements',
    'relations',
    'connectivity',
    'spatial'
])

/**
 * Owns lazily prepared named indexes for one document context.
 */
export class CircuitJsonContextIndexes {
    #builds
    #indexOptions
    #indexes = new Map()
    #model
    #sharedIndex = null

    /**
     * Creates a context-owned index registry.
     * @param {Record<string, any>} document Proven document envelope.
     * @param {Record<string, number>} builds Named index build counters.
     */
    constructor(document, builds) {
        this.#model = document.model
        this.#indexOptions = CircuitJsonValidationProof.indexOptions(document)
        this.#builds = builds
    }

    /**
     * Ensures every requested named index is available.
     * @param {unknown} names Requested index names.
     * @returns {CircuitJsonContextIndexes} This registry.
     */
    ensure(names = []) {
        for (const name of CircuitJsonContextIndexes.#names(names)) {
            if (!INDEX_NAMES.has(name)) {
                throw new RangeError(
                    `Unsupported CircuitJSON context index: ${name}.`
                )
            }
            if (this.#indexes.has(name)) continue

            this.#indexes.set(name, this.#build(name))
            this.#builds[name] = (this.#builds[name] || 0) + 1
        }
        return this
    }

    /**
     * Returns one named index, creating it when first requested.
     * @param {unknown} name Requested index name.
     * @returns {Record<string, any>} Prepared index.
     */
    get(name) {
        const normalized = String(name || '').trim()
        this.ensure([normalized])
        return this.#indexes.get(normalized)
    }

    /**
     * Returns true when one named index is already prepared.
     * @param {unknown} name Requested index name.
     * @returns {boolean} Whether the named index exists.
     */
    has(name) {
        return this.#indexes.has(String(name || '').trim())
    }

    /**
     * Creates one named view over the current monolithic legacy index.
     * @param {string} name Requested index name.
     * @returns {Record<string, any>} Named index view.
     */
    #build(name) {
        const shared = this.#shared()
        if (name === 'relations') {
            return {
                relationsByField: shared.relationsByField,
                componentsBySourceId: shared.componentsBySourceId,
                groupsById: shared.groupsById,
                elementsByGroupId: shared.elementsByGroupId,
                elementsBySubcircuitId: shared.elementsBySubcircuitId
            }
        }
        if (name === 'connectivity') {
            return {
                sourceTraceById: shared.sourceTraceById,
                sourceTraceConnectivity: shared.sourceTraceConnectivity,
                diagnostics: shared.diagnostics
            }
        }
        if (name === 'spatial') {
            return { elements: shared.elements }
        }
        return shared
    }

    /**
     * Returns the one shared legacy index used by named context views.
     * @returns {Record<string, any>} Shared element index.
     */
    #shared() {
        if (!this.#sharedIndex) {
            this.#sharedIndex = CircuitJsonIndexer.index(
                this.#model,
                this.#indexOptions
            )
        }
        return this.#sharedIndex
    }

    /**
     * Normalizes an index name request.
     * @param {unknown} names Requested names.
     * @returns {string[]} Normalized names.
     */
    static #names(names) {
        const candidates = Array.isArray(names) ? names : [names]
        return [
            ...new Set(candidates.map(String).map((name) => name.trim()))
        ].filter(Boolean)
    }
}
