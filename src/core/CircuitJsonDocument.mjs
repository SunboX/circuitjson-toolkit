/**
 * Validates serialized CircuitJSON element arrays.
 */
export class CircuitJsonDocument {
    /**
     * Returns true when a value is a CircuitJSON element.
     * @param {unknown} value Candidate value.
     * @returns {boolean}
     */
    static isElement(value) {
        return (
            Boolean(value) &&
            typeof value === 'object' &&
            typeof value.type === 'string' &&
            value.type.trim().length > 0
        )
    }

    /**
     * Returns true when a value is a CircuitJSON element array.
     * @param {unknown} value Candidate model.
     * @returns {boolean}
     */
    static isModel(value) {
        return (
            Array.isArray(value) &&
            value.every((element) => CircuitJsonDocument.isElement(element))
        )
    }

    /**
     * Throws when a value is not a CircuitJSON element array.
     * @param {unknown} value Candidate model.
     * @returns {void}
     */
    static assertModel(value) {
        if (!CircuitJsonDocument.isModel(value)) {
            throw new TypeError('Expected a CircuitJSON element array.')
        }
    }

    /**
     * Attaches non-serialized metadata to a CircuitJSON array.
     * @template {object[]} T
     * @param {T} circuitJson CircuitJSON model.
     * @param {{ fileName?: string, fileType?: string, kind?: string }} [metadata]
     * @returns {T}
     */
    static attachMetadata(circuitJson, metadata = {}) {
        CircuitJsonDocument.assertModel(circuitJson)
        Object.defineProperties(circuitJson, {
            fileName: {
                configurable: true,
                enumerable: true,
                value: String(metadata.fileName || ''),
                writable: true
            },
            fileType: {
                configurable: true,
                enumerable: true,
                value: String(metadata.fileType || 'circuitjson'),
                writable: true
            },
            kind: {
                configurable: true,
                enumerable: true,
                value: String(metadata.kind || 'pcb'),
                writable: true
            },
            sourceFormat: {
                configurable: true,
                enumerable: true,
                value: 'circuitjson',
                writable: true
            }
        })

        return circuitJson
    }
}
