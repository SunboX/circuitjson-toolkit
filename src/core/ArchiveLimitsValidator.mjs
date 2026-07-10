import { ToolkitError } from './contracts/ToolkitError.mjs'

const INTEGER_LIMITS = new Set([
    'maxEntries',
    'maxEntryBytes',
    'maxTotalBytes',
    'maxArchiveDepth'
])

/**
 * Validates caller-controlled archive safety limits against hard maxima.
 */
export class ArchiveLimitsValidator {
    /**
     * Normalizes bounded own overrides into a new immutable record.
     * @param {unknown} overrides Limit overrides.
     * @param {Record<string, number>} defaults Hard maximum values.
     * @returns {Readonly<Record<string, number>>} Normalized limits.
     */
    static normalize(overrides = {}, defaults = {}) {
        if (!ArchiveLimitsValidator.#isPlainRecord(overrides)) {
            throw ArchiveLimitsValidator.#error(
                '',
                'Archive limits must be a plain object.'
            )
        }

        const descriptors = Object.getOwnPropertyDescriptors(overrides)
        const allowed = new Set(Object.keys(defaults))
        for (const key of Reflect.ownKeys(descriptors)) {
            if (
                typeof key !== 'string' ||
                !allowed.has(key) ||
                descriptors[key].enumerable !== true ||
                descriptors[key].get ||
                descriptors[key].set
            ) {
                throw ArchiveLimitsValidator.#error(
                    typeof key === 'string' ? key : '',
                    'Archive limits contain an unknown or accessor-backed key.'
                )
            }
        }

        const normalized = {}
        for (const [key, maximum] of Object.entries(defaults)) {
            const descriptor = descriptors[key]
            const value = descriptor ? descriptor.value : maximum
            ArchiveLimitsValidator.#assertValue(key, value, maximum)
            normalized[key] = value
        }
        return Object.freeze(normalized)
    }

    /**
     * Checks whether a value is an ordinary own-property record.
     * @param {unknown} value Candidate record.
     * @returns {boolean} Whether the record is safe to inspect.
     */
    static #isPlainRecord(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false
        }
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }

    /**
     * Validates one numeric override.
     * @param {string} key Limit name.
     * @param {unknown} value Limit value.
     * @param {number} maximum Hard maximum.
     * @returns {void}
     */
    static #assertValue(key, value, maximum) {
        const number = typeof value === 'number' ? value : Number.NaN
        const minimum = key === 'maxArchiveDepth' ? 0 : Number.MIN_VALUE
        const invalidInteger =
            INTEGER_LIMITS.has(key) && !Number.isSafeInteger(number)
        if (
            !Number.isFinite(number) ||
            invalidInteger ||
            number < minimum ||
            number > maximum
        ) {
            throw ArchiveLimitsValidator.#error(
                key,
                `Archive limit ${key} is outside its safe range.`
            )
        }
    }

    /**
     * Creates a stable invalid-limit error.
     * @param {string} key Rejected key.
     * @param {string} message Failure message.
     * @returns {ToolkitError} Typed validation error.
     */
    static #error(key, message) {
        return new ToolkitError(message, {
            code: 'ERR_ARCHIVE_LIMIT_INVALID',
            category: 'validation',
            format: 'archive',
            details: key ? { key } : {}
        })
    }
}
