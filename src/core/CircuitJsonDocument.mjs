import { CircuitJsonElementValidator } from './CircuitJsonElementValidator.mjs'
import { CircuitJsonLegacyModel } from './context/CircuitJsonLegacyModel.mjs'
import { CircuitJsonLegacyNormalizer } from './context/CircuitJsonLegacyNormalizer.mjs'

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
     * Projects supported pre-union aliases onto the current CircuitJSON model.
     * @param {unknown} model CircuitJSON model candidate.
     * @param {{ owned?: boolean }} [options] Ownership options.
     * @returns {unknown} Original model or its canonical projection.
     */
    static normalizeModel(model, options = {}) {
        return CircuitJsonLegacyNormalizer.normalize(model, options)
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
        return CircuitJsonLegacyModel.attachValidated(circuitJson, metadata)
    }
}
