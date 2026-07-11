import { ToolkitError } from './contracts/ToolkitError.mjs'

const MAX_ATTACHED_VALUES = 100_000

/**
 * Enforces the request-global ceiling for caller-attached asset values.
 */
export class AttachedValueLimits {
    /**
     * Returns the hard attached-value ceiling shared by every execution path.
     * @returns {number} Maximum attached values per request.
     */
    static get maximum() {
        return MAX_ATTACHED_VALUES
    }

    /**
     * Adds one attached-value array length without visiting its elements.
     * @param {unknown} values Attached-value array candidate.
     * @param {number} [current] Values already counted in this request.
     * @returns {number} Updated request-global count.
     */
    static add(values, current = 0) {
        if (!Array.isArray(values)) {
            throw new TypeError('Attached values must be an array.')
        }
        let prototype
        let lengthDescriptor
        try {
            prototype = Object.getPrototypeOf(values)
            lengthDescriptor = Object.getOwnPropertyDescriptor(values, 'length')
        } catch {
            throw new TypeError(
                'Attached values could not be inspected safely.'
            )
        }
        const length = lengthDescriptor?.value
        if (
            prototype !== Array.prototype ||
            !lengthDescriptor ||
            !Object.hasOwn(lengthDescriptor, 'value') ||
            !Number.isSafeInteger(length) ||
            length < 0
        ) {
            throw new TypeError('Attached values must be a plain array.')
        }
        const total = current + length
        if (!Number.isSafeInteger(total) || total > MAX_ATTACHED_VALUES) {
            throw new ToolkitError(
                `Attached values exceed the ${MAX_ATTACHED_VALUES} item limit.`,
                {
                    code: 'ERR_ATTACHED_VALUE_LIMIT_EXCEEDED',
                    category: 'validation',
                    format: 'circuitjson',
                    details: {
                        attachedValues: total,
                        maxAttachedValues: MAX_ATTACHED_VALUES
                    }
                }
            )
        }
        return total
    }
}

Object.freeze(AttachedValueLimits.prototype)
Object.freeze(AttachedValueLimits)
