import { ToolkitError } from '../contracts/ToolkitError.mjs'

const SIDES = new Set(['top', 'bottom'])

/**
 * Normalizes safe reusable PCB interaction options.
 */
export class CanonicalInteractionOptions {
    /**
     * Normalizes a safe finite CircuitJSON millimeter point.
     * @param {unknown} point Point candidate.
     * @returns {{ x: number, y: number }} Normalized point.
     */
    static point(point) {
        if (!point || typeof point !== 'object') {
            throw CanonicalInteractionOptions.error(
                'Interaction point must be a plain finite x/y object.'
            )
        }
        let prototype
        let descriptors
        try {
            if (Array.isArray(point)) throw new TypeError('array')
            prototype = Object.getPrototypeOf(point)
            descriptors = Object.getOwnPropertyDescriptors(point)
        } catch {
            throw CanonicalInteractionOptions.error(
                'Interaction point could not be inspected safely.'
            )
        }
        const x = CanonicalInteractionOptions.#dataValue(descriptors.x)
        const y = CanonicalInteractionOptions.#dataValue(descriptors.y)
        if (
            (prototype !== Object.prototype && prototype !== null) ||
            typeof x !== 'number' ||
            typeof y !== 'number' ||
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            throw CanonicalInteractionOptions.error(
                'Interaction point must be a plain finite x/y object.'
            )
        }
        return { x, y }
    }

    /**
     * Normalizes one option record over existing defaults.
     * @param {unknown} options Option candidate.
     * @param {Record<string, any>} [defaults] Existing normalized defaults.
     * @returns {{ side: 'top' | 'bottom' | null, tolerance: number, hiddenLayers: string[], hiddenObjects: string[] }} Normalized options.
     */
    static normalize(options = {}, defaults = {}) {
        const record = CanonicalInteractionOptions.#record(options)
        return {
            side: CanonicalInteractionOptions.#side(
                record.side,
                defaults.side ?? null
            ),
            tolerance: CanonicalInteractionOptions.#tolerance(
                record.tolerance,
                defaults.tolerance ?? 0.2
            ),
            hiddenLayers: CanonicalInteractionOptions.#strings(
                record.hiddenLayers,
                defaults.hiddenLayers || [],
                'hiddenLayers'
            ),
            hiddenObjects: CanonicalInteractionOptions.#strings(
                record.hiddenObjects,
                defaults.hiddenObjects || [],
                'hiddenObjects'
            )
        }
    }

    /**
     * Reads supported own data fields without invoking accessors.
     * @param {unknown} value Option candidate.
     * @returns {Record<string, any>} Safe option record.
     */
    static #record(value) {
        if (!value || typeof value !== 'object') {
            throw CanonicalInteractionOptions.error(
                'Interaction options must be a plain object.'
            )
        }
        let prototype
        let descriptors
        try {
            if (Array.isArray(value)) throw new TypeError('array')
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw CanonicalInteractionOptions.error(
                'Interaction options could not be inspected safely.'
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw CanonicalInteractionOptions.error(
                'Interaction options must be a plain object.'
            )
        }
        const allowed = new Set([
            'hiddenLayers',
            'hiddenObjects',
            'side',
            'tolerance'
        ])
        const result = {}
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                !allowed.has(key) ||
                descriptor.enumerable !== true ||
                descriptor.get ||
                descriptor.set
            ) {
                throw CanonicalInteractionOptions.error(
                    'Interaction options contain an unsupported field.'
                )
            }
            result[key] = descriptor.value
        }
        return result
    }

    /**
     * Normalizes one optional board side.
     * @param {unknown} value Side candidate.
     * @param {'top' | 'bottom' | null} fallback Fallback side.
     * @returns {'top' | 'bottom' | null} Normalized side.
     */
    static #side(value, fallback) {
        const side = value === undefined ? fallback : value
        if (side !== null && !SIDES.has(side)) {
            throw CanonicalInteractionOptions.error(
                'Interaction side must be top or bottom.'
            )
        }
        return side
    }

    /**
     * Normalizes one nonnegative interaction tolerance.
     * @param {unknown} value Tolerance candidate.
     * @param {number} fallback Fallback tolerance.
     * @returns {number} Normalized tolerance.
     */
    static #tolerance(value, fallback) {
        const tolerance = value === undefined ? fallback : value
        if (
            typeof tolerance !== 'number' ||
            !Number.isFinite(tolerance) ||
            tolerance < 0 ||
            tolerance > 1000000
        ) {
            throw CanonicalInteractionOptions.error(
                'Interaction tolerance must be a bounded nonnegative number.'
            )
        }
        return tolerance
    }

    /**
     * Normalizes one unique string-list option through data descriptors.
     * @param {unknown} value Array candidate.
     * @param {string[]} fallback Fallback values.
     * @param {string} name Option name.
     * @returns {string[]} Normalized strings.
     */
    static #strings(value, fallback, name) {
        if (value === undefined) return [...fallback]
        let descriptors
        try {
            if (
                !Array.isArray(value) ||
                Object.getPrototypeOf(value) !== Array.prototype
            ) {
                throw new TypeError('array')
            }
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw CanonicalInteractionOptions.error(
                `Interaction ${name} must be a plain string array.`
            )
        }
        const length = descriptors.length?.value
        if (!Number.isSafeInteger(length) || length < 0 || length > 4096) {
            throw CanonicalInteractionOptions.error(
                `Interaction ${name} must be a bounded string array.`
            )
        }
        const result = []
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                descriptor.get ||
                descriptor.set ||
                typeof descriptor.value !== 'string' ||
                !descriptor.value.trim()
            ) {
                throw CanonicalInteractionOptions.error(
                    `Interaction ${name} must contain non-empty strings.`
                )
            }
            result.push(descriptor.value.trim())
        }
        const allowed = new Set([
            'length',
            ...Array.from({ length }, (_entry, index) => String(index))
        ])
        if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(key))) {
            throw CanonicalInteractionOptions.error(
                `Interaction ${name} must be a plain string array.`
            )
        }
        return [...new Set(result)]
    }

    /**
     * Returns a descriptor's own data value without invoking accessors.
     * @param {PropertyDescriptor | undefined} descriptor Field descriptor.
     * @returns {unknown} Data value or undefined.
     */
    static #dataValue(descriptor) {
        return descriptor && !descriptor.get && !descriptor.set
            ? descriptor.value
            : undefined
    }

    /**
     * Creates one typed interaction-option error.
     * @param {string} message Failure message.
     * @returns {ToolkitError} Typed error.
     */
    static error(message) {
        return new ToolkitError(message, {
            code: 'ERR_INTERACTION_OPTIONS',
            category: 'validation',
            format: 'circuitjson'
        })
    }
}
