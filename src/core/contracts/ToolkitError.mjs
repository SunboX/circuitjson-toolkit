import { cloneSafeValue } from './ToolkitDiagnostic.mjs'

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
        this.name = 'ToolkitError'
        this.code = String(fields.code || 'ERR_TOOLKIT_RUNTIME')
        this.category = String(fields.category || 'runtime')
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
        return error instanceof ToolkitError
            ? error
            : new ToolkitError(error?.message || error, {
                  ...fields,
                  cause: error
              })
    }

    /**
     * Creates a clone-safe cause summary.
     * @param {unknown} error Cause candidate.
     * @returns {{ name: string, message: string, code: string | null } | null} Cause summary.
     */
    static cloneSafeCause(error) {
        if (!error) return null
        return {
            name: String(error.name || 'Error'),
            message: String(error.message || error),
            code: error.code == null ? null : String(error.code)
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
