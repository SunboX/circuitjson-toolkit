/**
 * Collects JSON-shaped model values and freezes them only after validation.
 */
export class CircuitJsonModelFreezeTraversal {
    #enabled
    #model
    #seen
    #targets = []
    #unsupportedAccessor = false
    #unsupportedContainer = false

    /**
     * Creates a postorder model freeze traversal.
     * @param {object[]} model Root CircuitJSON model.
     * @param {boolean} enabled Whether values should be collected.
     */
    constructor(model, enabled) {
        this.#enabled = enabled
        this.#model = model
        this.#seen = new Set()
        this.visit(model)
    }

    /**
     * Visits one value in child-first order.
     * @param {unknown} value Candidate model value.
     * @returns {void}
     */
    visit(value) {
        if (!this.#enabled) {
            return
        }
        if (typeof value === 'function') {
            this.#unsupportedContainer = true
            return
        }
        if (value === null || typeof value !== 'object') return
        if (!CircuitJsonModelFreezeTraversal.#plain(value)) {
            this.#unsupportedContainer = true
            return
        }
        if (this.#seen.has(value)) return
        this.#seen.add(value)

        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (!Object.hasOwn(descriptor, 'value')) {
                this.#unsupportedAccessor = true
                continue
            }
            this.visit(descriptor.value)
        }
        this.#targets.push(value)
    }

    /**
     * Returns immutable-model shape errors found during traversal.
     * @returns {string[]} Validation errors.
     */
    errors() {
        const errors = []
        if (this.#unsupportedContainer) {
            errors.push(
                'Immutable CircuitJSON models may contain only primitives, plain objects and arrays.'
            )
        }
        if (this.#unsupportedAccessor) {
            errors.push(
                'Immutable CircuitJSON models may contain only data properties.'
            )
        }
        return errors
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

Object.freeze(CircuitJsonModelFreezeTraversal.prototype)
Object.freeze(CircuitJsonModelFreezeTraversal)
