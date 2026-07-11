import { CIRCUIT_JSON_UPSTREAM_DEFAULT_ID_FIELDS } from './CircuitJsonUpstreamSchema.mjs'

/**
 * Reports upstream defaults intentionally left unmaterialized by raw parsing.
 */
export class CircuitJsonSerializedInputAudit {
    /**
     * Audits missing random upstream identity defaults without mutating input.
     * @param {unknown} model Serialized CircuitJSON model candidate.
     * @param {string} [source] Source identity for diagnostics.
     * @returns {{ diagnostics: object[], statistics: Record<string, number> }} Audit rows.
     */
    static inspect(model, source = '') {
        if (!Array.isArray(model)) {
            return { diagnostics: [], statistics: {} }
        }
        let length
        try {
            length = Object.getOwnPropertyDescriptor(model, 'length')?.value
        } catch {
            return { diagnostics: [], statistics: {} }
        }
        if (!Number.isSafeInteger(length) || length < 0) {
            return { diagnostics: [], statistics: {} }
        }
        const diagnostics = []
        for (let index = 0; index < length; index += 1) {
            const element = CircuitJsonSerializedInputAudit.#dataField(
                model,
                String(index)
            )
            const type = CircuitJsonSerializedInputAudit.#dataField(
                element,
                'type'
            )
            if (typeof type !== 'string') continue
            const idField = CIRCUIT_JSON_UPSTREAM_DEFAULT_ID_FIELDS[type]
            if (!idField) continue
            const identity = CircuitJsonSerializedInputAudit.#dataField(
                element,
                idField
            )
            if (identity !== undefined) continue
            diagnostics.push({
                code: 'CIRCUITJSON_UPSTREAM_DEFAULT_ID_OMITTED',
                severity: 'warning',
                message:
                    `Serialized CircuitJSON omitted ${idField}; ` +
                    'the random upstream default was not materialized.',
                source,
                location: { elementIndex: index },
                details: {
                    elementType: type,
                    idField,
                    materialized: false
                }
            })
        }
        return {
            diagnostics,
            statistics: diagnostics.length
                ? { upstreamDefaultIdentityOmissions: diagnostics.length }
                : {}
        }
    }

    /**
     * Reads one own data field without invoking caller accessors.
     * @param {unknown} owner Field owner.
     * @param {string} key Field name.
     * @returns {unknown} Data value or undefined.
     */
    static #dataField(owner, key) {
        if (!owner || typeof owner !== 'object') return undefined
        try {
            const descriptor = Object.getOwnPropertyDescriptor(owner, key)
            return descriptor && Object.hasOwn(descriptor, 'value')
                ? descriptor.value
                : undefined
        } catch {
            return undefined
        }
    }
}

Object.freeze(CircuitJsonSerializedInputAudit.prototype)
Object.freeze(CircuitJsonSerializedInputAudit)
