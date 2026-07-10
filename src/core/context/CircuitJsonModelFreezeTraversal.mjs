/**
 * Collects JSON-shaped model values and freezes them only after validation.
 */
export class CircuitJsonModelFreezeTraversal {
    #enabled
    #model
    #seen
    #targets = []
    #unsupported = false

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
        if (!this.#enabled || value === null || typeof value !== 'object') {
            return
        }
        if (!CircuitJsonModelFreezeTraversal.#plain(value)) {
            this.#unsupported = true
            return
        }
        if (this.#seen.has(value)) return
        this.#seen.add(value)

        const children = Array.isArray(value) ? value : Object.values(value)
        for (const child of children) this.visit(child)
        this.#targets.push(value)
    }

    /**
     * Returns immutable-model shape errors found during traversal.
     * @returns {string[]} Validation errors.
     */
    errors() {
        return this.#unsupported
            ? [
                  'Immutable CircuitJSON models may contain only primitives, plain objects and arrays.'
              ]
            : []
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
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }
}
