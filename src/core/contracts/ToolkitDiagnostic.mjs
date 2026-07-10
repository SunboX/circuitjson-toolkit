/**
 * Creates a structured-clone-safe copy of one contract value.
 * @param {unknown} value Candidate value.
 * @param {unknown} fallback Value used when cloning is impossible.
 * @returns {any} Clone-safe value.
 */
export function cloneSafeValue(value, fallback = null) {
    if (value === undefined) return fallback
    try {
        return structuredClone(value)
    } catch {
        return fallback
    }
}

/**
 * Normalizes toolkit diagnostics into the shared clone-safe record shape.
 */
export class ToolkitDiagnostic {
    /**
     * Creates one diagnostic record.
     * @param {Record<string, any>} [fields] Diagnostic fields.
     * @returns {{ code: string, severity: string, message: string, source: string, location: any, details: any }} Normalized diagnostic.
     */
    static create(fields = {}) {
        return {
            code: String(fields.code || 'TOOLKIT_DIAGNOSTIC'),
            severity: String(fields.severity || 'info'),
            message: String(fields.message || ''),
            source: String(fields.source || ''),
            location: cloneSafeValue(fields.location, null),
            details: cloneSafeValue(fields.details, {})
        }
    }
}
