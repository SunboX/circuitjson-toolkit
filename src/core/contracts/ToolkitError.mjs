import { cloneSafeValue } from './ToolkitDiagnostic.mjs'

const ERROR_CATEGORIES = new Set([
    'parse',
    'validation',
    'unsupported',
    'cancelled',
    'runtime'
])
const TOOLKIT_ERROR_INSTANCES = new WeakSet()

/**
 * Shared typed toolkit failure with clone-safe serialization.
 */
export class ToolkitError extends Error {
    /**
     * Creates a typed toolkit error.
     * @param {unknown} message Error message.
     * @param {Record<string, any>} [fields] Structured failure fields.
     */
    constructor(message, fields = {}) {
        super(String(message || 'Toolkit operation failed.'))
        TOOLKIT_ERROR_INSTANCES.add(this)
        this.name = 'ToolkitError'
        this.code = String(fields.code || 'ERR_TOOLKIT_RUNTIME')
        const category = String(fields.category || 'runtime')
        this.category = ERROR_CATEGORIES.has(category) ? category : 'runtime'
        this.format = String(fields.format || 'circuitjson')
        this.source = String(fields.source || '')
        this.location = cloneSafeValue(fields.location, null)
        this.details = cloneSafeValue(fields.details, {})
        this.cause = ToolkitError.cloneSafeCause(fields.cause)
    }

    /**
     * Normalizes any thrown value into ToolkitError.
     * @param {unknown} error Error candidate.
     * @param {Record<string, any>} [fields] Override fields.
     * @returns {ToolkitError} Typed error.
     */
    static from(error, fields = {}) {
        if (TOOLKIT_ERROR_INSTANCES.has(error)) return error
        const cause = ToolkitError.cloneSafeCause(error)
        return new ToolkitError(cause?.message || 'Toolkit operation failed.', {
            ...fields,
            cause
        })
    }

    /**
     * Creates a clone-safe cause summary.
     * @param {unknown} error Cause candidate.
     * @returns {{ name: string, message: string, code: string | null } | null} Cause summary.
     */
    static cloneSafeCause(error) {
        if (error === null || error === undefined) return null
        const recordLike = ['object', 'function'].includes(typeof error)
        const name = recordLike
            ? ToolkitError.#safeProperty(error, 'name')
            : null
        const message = recordLike
            ? ToolkitError.#safeProperty(error, 'message')
            : error
        const code = recordLike
            ? ToolkitError.#safeProperty(error, 'code')
            : null
        return {
            name: ToolkitError.#safeString(name, 'Error'),
            message: ToolkitError.#safeString(
                message ?? error,
                'Uninspectable thrown value.'
            ),
            code: code == null ? null : ToolkitError.#safeString(code, null)
        }
    }

    /**
     * Reads one error field without trusting a thrown object.
     * @param {object | Function} value Error-like value.
     * @param {string} key Field name.
     * @returns {unknown} Field value or undefined.
     */
    static #safeProperty(value, key) {
        try {
            return value[key]
        } catch {
            return undefined
        }
    }

    /**
     * Converts a value to string without allowing conversion traps to escape.
     * @param {unknown} value String candidate.
     * @param {string | null} fallback Fallback string.
     * @returns {string | null} Safe string.
     */
    static #safeString(value, fallback) {
        if (value === null || value === undefined || value === '') {
            return fallback
        }
        try {
            return String(value)
        } catch {
            return fallback
        }
    }

    /**
     * Serializes the error without prototype-only state.
     * @returns {{ name: string, message: string, code: string, category: string, format: string, source: string, location: any, details: any, cause: any }} Clone-safe error record.
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            category: this.category,
            format: this.format,
            source: this.source,
            location: this.location,
            details: this.details,
            cause: this.cause
        }
    }
}
