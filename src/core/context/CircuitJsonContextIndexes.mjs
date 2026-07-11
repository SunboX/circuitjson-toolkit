import { CircuitJsonIndexer } from '../CircuitJsonIndexer.mjs'
import { CircuitJsonValidationProof } from './CircuitJsonValidationProof.mjs'

const INDEX_NAMES = new Set([
    'elements',
    'identifiers',
    'relations',
    'connectivity',
    'spatial'
])

/**
 * Owns lazily prepared named indexes for one document context.
 */
export class CircuitJsonContextIndexes {
    #builds
    #document
    #indexes = new Map()
    #model

    /**
     * Creates a context-owned index registry.
     * @param {Record<string, any>} document Proven document envelope.
     * @param {object[]} model Proven CircuitJSON model.
     * @param {Record<string, number>} builds Named index build counters.
     */
    constructor(document, model, builds) {
        this.#document = document
        this.#model = model
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
     * Creates only the work family requested by one named index.
     * @param {string} name Requested index name.
     * @returns {Record<string, any>} Named index view.
     */
    #build(name) {
        return CircuitJsonIndexer.index(
            this.#model,
            CircuitJsonValidationProof.indexOptions(this.#document, [name])
        )
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
