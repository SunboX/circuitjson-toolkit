/**
 * Collects JSON-shaped model values and freezes them only after validation.
 */
export class CircuitJsonModelFreezeTraversal {
    #cyclic = false
    #enabled
    #model
    #seen
    #targets = []
    #unsupportedAccessor = false
    #unsupportedContainer = false
    #unsupportedShape = false
    #visiting

    /**
     * Creates a postorder model freeze traversal.
     * @param {object[]} model Root CircuitJSON model.
     * @param {boolean} enabled Whether values should be collected.
     */
    constructor(model, enabled) {
        this.#enabled = enabled
        this.#model = model
        this.#seen = new Set()
        this.#visiting = new Set()
        this.visit(model)
    }

    /**
     * Visits one value in iterative child-first order.
     * @param {unknown} value Candidate model value.
     * @returns {void}
     */
    visit(value) {
        if (!this.#enabled) return
        const stack = [{ exit: false, value }]
        while (stack.length) {
            const frame = stack.pop()
            if (frame.exit) {
                this.#visiting.delete(frame.value)
                this.#targets.push(frame.value)
                continue
            }
            const current = frame.value
            if (typeof current === 'function') {
                this.#unsupportedContainer = true
                continue
            }
            if (current === null || typeof current !== 'object') continue
            if (!CircuitJsonModelFreezeTraversal.#plain(current)) {
                this.#unsupportedContainer = true
                continue
            }
            if (this.#visiting.has(current)) {
                this.#cyclic = true
                continue
            }
            if (this.#seen.has(current)) continue
            this.#seen.add(current)
            this.#visiting.add(current)

            const descriptors = Object.getOwnPropertyDescriptors(current)
            const children = Array.isArray(current)
                ? this.#arrayChildren(current, descriptors)
                : this.#recordChildren(descriptors)
            stack.push({ exit: true, value: current })
            for (let index = children.length - 1; index >= 0; index -= 1) {
                stack.push({ exit: false, value: children[index] })
            }
        }
    }

    /**
     * Visits one dense array through enumerable index data descriptors.
     * @param {any[]} value Array value.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @returns {unknown[]} Child values.
     */
    #arrayChildren(value, descriptors) {
        const keys = Reflect.ownKeys(descriptors)
        const length = descriptors.length?.value
        if (
            !Number.isSafeInteger(length) ||
            length < 0 ||
            keys.length !== length + 1
        ) {
            this.#unsupportedShape = true
            return []
        }
        const children = []
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                this.#unsupportedAccessor = true
                continue
            }
            if (descriptor.enumerable !== true) {
                this.#unsupportedShape = true
                continue
            }
            children.push(descriptor.value)
        }
        return children
    }

    /**
     * Visits one record through enumerable string-keyed data descriptors.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @returns {unknown[]} Child values.
     */
    #recordChildren(descriptors) {
        const children = []
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (!Object.hasOwn(descriptor, 'value')) {
                this.#unsupportedAccessor = true
                continue
            }
            if (typeof key !== 'string' || descriptor.enumerable !== true) {
                this.#unsupportedShape = true
                continue
            }
            children.push(descriptor.value)
        }
        return children
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
        if (this.#unsupportedShape) {
            errors.push(
                'Immutable CircuitJSON models must use dense arrays and enumerable string-keyed properties.'
            )
        }
        if (this.#cyclic) {
            errors.push('Immutable CircuitJSON models must not contain cycles.')
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
        if (Array.isArray(value)) {
            return Object.getPrototypeOf(value) === Array.prototype
        }
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }
}

Object.freeze(CircuitJsonModelFreezeTraversal.prototype)
Object.freeze(CircuitJsonModelFreezeTraversal)
