import { cloneSafeValue } from './ToolkitDiagnostic.mjs'
import { RuntimeProxyBoundary } from './RuntimeProxyBoundary.mjs'

const ERROR_CATEGORIES = new Set([
    'parse',
    'validation',
    'unsupported',
    'cancelled',
    'runtime'
])

/**
 * Shared typed toolkit failure with clone-safe serialization.
 */
export class ToolkitError extends Error {
    #trustedRecord

    /**
     * Creates a typed toolkit error.
     * @param {unknown} message Error message.
     * @param {Record<string, any>} [fields] Structured failure fields.
     */
    constructor(message, fields = {}) {
        super(String(message || 'Toolkit operation failed.'))
        this.name = 'ToolkitError'
        this.code = String(fields.code || 'ERR_TOOLKIT_RUNTIME')
        const category = String(fields.category || 'runtime')
        this.category = ERROR_CATEGORIES.has(category) ? category : 'runtime'
        this.format = String(fields.format || 'circuitjson')
        this.source = String(fields.source || '')
        this.location = cloneSafeValue(fields.location, null)
        this.details = cloneSafeValue(fields.details, {})
        this.cause = ToolkitError.cloneSafeCause(fields.cause)
        this.#trustedRecord = {
            name: this.name,
            message: this.message,
            code: this.code,
            category: this.category,
            format: this.format,
            source: this.source,
            location: cloneSafeValue(this.location, null),
            details: cloneSafeValue(this.details, {}),
            cause: cloneSafeValue(this.cause, null)
        }
    }

    /**
     * Normalizes any thrown value into ToolkitError.
     * @param {unknown} error Error candidate.
     * @param {Record<string, any>} [fields] Override fields.
     * @returns {ToolkitError} Typed error.
     */
    static from(error, fields = {}) {
        if (ToolkitError.trustedRecord(error)) return error
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
        if (!error) return null
        if (!['object', 'function'].includes(typeof error)) {
            return {
                name: 'Error',
                message: ToolkitError.#primitiveText(error, 'Error'),
                code: null
            }
        }
        try {
            RuntimeProxyBoundary.assert(error, 'Toolkit error cause')
        } catch {
            return {
                name: 'Error',
                message: 'Toolkit operation failed.',
                code: null
            }
        }
        const name = ToolkitError.#dataField(error, 'name')
        const message = ToolkitError.#dataField(error, 'message')
        const code = ToolkitError.#dataField(error, 'code')
        return {
            name: ToolkitError.#primitiveText(name, 'Error'),
            message: ToolkitError.#primitiveText(
                message,
                'Toolkit operation failed.'
            ),
            code:
                code === null || code === undefined
                    ? null
                    : ToolkitError.#primitiveText(code, null)
        }
    }

    /**
     * Reads one inherited data property without invoking an accessor.
     * @param {object | Function} value Property owner.
     * @param {string} key Property key.
     * @returns {unknown} Data value or undefined.
     */
    static #dataField(value, key) {
        let owner = value
        for (let depth = 0; owner && depth < 16; depth += 1) {
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(owner, key)
                owner = Object.getPrototypeOf(owner)
            } catch {
                return undefined
            }
            if (!descriptor) continue
            return Object.hasOwn(descriptor, 'value')
                ? descriptor.value
                : undefined
        }
        return undefined
    }

    /**
     * Converts only primitive values to bounded error text.
     * @param {unknown} value Text candidate.
     * @param {string | null} fallback Missing or unsafe fallback.
     * @returns {string | null} Safe text.
     */
    static #primitiveText(value, fallback) {
        if (
            value === null ||
            value === undefined ||
            ['object', 'function'].includes(typeof value)
        ) {
            return fallback
        }
        try {
            return String(value)
        } catch {
            return fallback
        }
    }

    /**
     * Returns construction-time fields only for a genuine unproxied instance.
     * @param {unknown} error Error candidate.
     * @returns {ReturnType<ToolkitError['toJSON']> | null} Trusted record.
     */
    static trustedRecord(error) {
        try {
            return cloneSafeValue(error.#trustedRecord, null)
        } catch {
            return null
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
