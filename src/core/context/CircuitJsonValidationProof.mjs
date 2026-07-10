const VALIDATION_PROOF = Symbol('CircuitJsonValidationProof')
const VALIDATED_INDEX_ACCESS = Symbol('CircuitJsonValidatedIndexAccess')

/**
 * Collects model values during validation and freezes them only after success.
 */
class CircuitJsonModelFreezeTraversal {
    #enabled
    #model
    #seen
    #targets = []

    /**
     * Creates a postorder model freeze traversal.
     * @param {object[]} model Root CircuitJSON model.
     * @param {boolean} enabled Whether values should be collected.
     */
    constructor(model, enabled) {
        this.#enabled = enabled
        this.#model = model
        this.#seen = new Set([model])
    }

    /**
     * Visits one value in child-first order.
     * @param {unknown} value Candidate model value.
     * @returns {void}
     */
    visit(value) {
        if (!this.#enabled || !CircuitJsonModelFreezeTraversal.#plain(value)) {
            return
        }
        if (this.#seen.has(value)) return
        this.#seen.add(value)

        const children = Array.isArray(value) ? value : Object.values(value)
        for (const child of children) this.visit(child)
        this.#targets.push(value)
    }

    /**
     * Freezes collected values when the complete model passed validation.
     * @param {boolean} valid Whether validation succeeded.
     * @returns {void}
     */
    commit(valid) {
        if (!this.#enabled || !valid) return
        for (const target of this.#targets) Object.freeze(target)
        Object.freeze(this.#model)
    }

    /**
     * Returns true for arrays and true plain object records.
     * @param {unknown} value Candidate.
     * @returns {boolean}
     */
    static #plain(value) {
        if (Array.isArray(value)) return true
        if (!value || typeof value !== 'object') return false
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }
}

/**
 * Owns runtime-only proof metadata for immutable CircuitJSON documents.
 */
export class CircuitJsonValidationProof {
    /**
     * Creates a traversal that freezes model values after successful validation.
     * @param {object[]} model Root CircuitJSON model.
     * @param {boolean} enabled Whether freezing was requested.
     * @returns {CircuitJsonModelFreezeTraversal} Freeze traversal.
     */
    static freezeTraversal(model, enabled) {
        return new CircuitJsonModelFreezeTraversal(model, enabled)
    }

    /**
     * Attaches a proof bound to the envelope's current immutable model.
     * @param {Record<string, any>} document Canonical document envelope.
     * @returns {Record<string, any>} The same document envelope.
     */
    static attach(document) {
        if (
            !Array.isArray(document?.model) ||
            !Object.isFrozen(document.model)
        ) {
            throw new TypeError(
                'A validation proof requires an immutable CircuitJSON model.'
            )
        }
        if (CircuitJsonValidationProof.has(document)) return document

        Object.defineProperty(document, VALIDATION_PROOF, {
            configurable: true,
            enumerable: false,
            value: Object.freeze({ model: document.model }),
            writable: false
        })
        return document
    }

    /**
     * Returns true when an envelope proof matches its current model reference.
     * @param {unknown} document Document candidate.
     * @returns {boolean} Whether the envelope carries a reusable proof.
     */
    static has(document) {
        const proof = document?.[VALIDATION_PROOF]
        return Boolean(
            proof &&
            Array.isArray(document?.model) &&
            proof.model === document.model &&
            Object.isFrozen(document.model)
        )
    }

    /**
     * Creates context-owned indexer options branded by a matching proof.
     * @param {Record<string, any>} document Proven document envelope.
     * @returns {{ validated: true }} Trusted indexer options.
     */
    static indexOptions(document) {
        if (!CircuitJsonValidationProof.has(document)) {
            throw new TypeError(
                'Validated index access requires a matching document proof.'
            )
        }

        const options = { validated: true }
        Object.defineProperty(options, VALIDATED_INDEX_ACCESS, {
            enumerable: false,
            value: document[VALIDATION_PROOF]
        })
        return Object.freeze(options)
    }

    /**
     * Returns true only for an index request branded by a matching proof.
     * @param {unknown} model CircuitJSON model candidate.
     * @param {unknown} options Indexer options candidate.
     * @returns {boolean} Whether public validation may be skipped.
     */
    static permitsIndex(model, options) {
        const proof = options?.[VALIDATED_INDEX_ACCESS]
        return Boolean(
            options?.validated === true &&
            proof &&
            proof.model === model &&
            Object.isFrozen(model)
        )
    }
}
