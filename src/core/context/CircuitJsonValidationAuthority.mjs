import { CircuitJsonElementValidator } from '../CircuitJsonElementValidator.mjs'

const PROVEN_MODELS = new WeakSet()
const validateCircuitJsonModel = CircuitJsonElementValidator.validateModel.bind(
    CircuitJsonElementValidator
)

/**
 * Owns the unforgeable deep-validation authority used by document sealing.
 */
export class CircuitJsonValidationAuthority {
    /**
     * Validates and freezes one model before granting private sealing authority.
     * @param {unknown} model CircuitJSON model candidate.
     * @returns {string[]} Validation errors.
     */
    static validateAndFreeze(model) {
        const errors = validateCircuitJsonModel(model, { freeze: true })
        if (errors.length === 0) PROVEN_MODELS.add(model)
        return errors
    }

    /**
     * Tests the module-private authority for one exact deeply frozen model.
     * @param {unknown} model Model candidate.
     * @returns {boolean} Whether validation granted sealing authority.
     */
    static permitsSeal(model) {
        return Boolean(
            model &&
            typeof model === 'object' &&
            PROVEN_MODELS.has(model) &&
            Object.isFrozen(model)
        )
    }
}

Object.freeze(CircuitJsonValidationAuthority.prototype)
Object.freeze(CircuitJsonValidationAuthority)
