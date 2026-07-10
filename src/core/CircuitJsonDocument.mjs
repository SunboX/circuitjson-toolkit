import { CircuitJsonElementValidator } from './CircuitJsonElementValidator.mjs'

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
        return CircuitJsonElementValidator.validateElement(value).length === 0
    }

    /**
     * Returns true when a value is a CircuitJSON element array.
     * @param {unknown} value Candidate model.
     * @returns {boolean}
     */
    static isModel(value) {
        return CircuitJsonElementValidator.validateModel(value).length === 0
    }

    /**
     * Returns validation errors for a candidate CircuitJSON element array.
     * @param {unknown} value Candidate model.
     * @param {{ freeze?: boolean }} [options] Validation options.
     * @returns {string[]}
     */
    static validateModel(value, options = {}) {
        return CircuitJsonElementValidator.validateModel(value, options)
    }

    /**
     * Throws when a value is not a CircuitJSON element array.
     * @param {unknown} value Candidate model.
     * @param {{ freeze?: boolean }} [options] Validation options.
     * @returns {void}
     */
    static assertModel(value, options = {}) {
        const errors = CircuitJsonDocument.validateModel(value, options)
        if (errors.length) {
            throw new TypeError(errors[0])
        }
    }

    /**
     * Attaches non-serialized metadata to a CircuitJSON array.
     * @template {object[]} T
     * @param {T} circuitJson CircuitJSON model.
     * @param {{ fileName?: string, fileType?: string, kind?: string, diagnostics?: object[], bom?: object[], supportMatrix?: object, manufacturing?: object }} [metadata]
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
            },
            diagnostics: {
                configurable: true,
                enumerable: true,
                value: Array.isArray(metadata.diagnostics)
                    ? metadata.diagnostics
                    : [],
                writable: true
            },
            bom: {
                configurable: true,
                enumerable: true,
                value: Array.isArray(metadata.bom) ? metadata.bom : [],
                writable: true
            },
            supportMatrix: {
                configurable: true,
                enumerable: true,
                value: metadata.supportMatrix || null,
                writable: true
            },
            manufacturing: {
                configurable: true,
                enumerable: true,
                value: metadata.manufacturing || {
                    pickAndPlaceRows: [],
                    routingDsn: ''
                },
                writable: true
            }
        })

        return circuitJson
    }
}
