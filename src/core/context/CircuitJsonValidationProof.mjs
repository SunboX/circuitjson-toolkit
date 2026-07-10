import { CircuitJsonDocument } from '../CircuitJsonDocument.mjs'
import { CircuitJsonReadOnlyDocument } from './CircuitJsonReadOnlyDocument.mjs'

const VALIDATION_PROOF = Symbol('CircuitJsonValidationProof')
const VALIDATED_INDEX_ACCESS = Symbol('CircuitJsonValidatedIndexAccess')
const VALIDATION_TOKEN_SECRET = Object.freeze({})

/**
 * Holds an unforgeable runtime binding to one validated model.
 */
class CircuitJsonValidationToken {
    #model

    /**
     * Creates a token for one already validated immutable model.
     * @param {object[]} model Proven CircuitJSON model.
     * @param {object} secret Module-private construction authority.
     */
    constructor(model, secret) {
        if (secret !== VALIDATION_TOKEN_SECRET) {
            throw new TypeError('CircuitJSON validation proofs are internal.')
        }
        this.#model = model
        Object.freeze(this)
    }

    /**
     * Tests whether a candidate token is bound to the supplied model.
     * @param {unknown} candidate Token candidate.
     * @param {unknown} model Model candidate.
     * @returns {boolean} Whether the private model slot matches.
     */
    static matches(candidate, model) {
        try {
            return (
                candidate.#model === model &&
                Array.isArray(model) &&
                Object.isFrozen(model)
            )
        } catch {
            return false
        }
    }
}

/**
 * Owns runtime-only proof metadata for immutable CircuitJSON documents.
 */
export class CircuitJsonValidationProof {
    /**
     * Validates, freezes, and proves one canonical document envelope.
     * @param {Record<string, any>} document Canonical document envelope.
     * @returns {Record<string, any>} The same read-only document envelope.
     */
    static validateAndAttach(document) {
        if (!CircuitJsonValidationProof.has(document)) {
            CircuitJsonDocument.assertModel(document?.model, { freeze: true })
            Object.defineProperty(document, VALIDATION_PROOF, {
                configurable: false,
                enumerable: false,
                value: new CircuitJsonValidationToken(
                    document.model,
                    VALIDATION_TOKEN_SECRET
                ),
                writable: false
            })
        }
        return CircuitJsonReadOnlyDocument.freeze(document)
    }

    /**
     * Returns true when an envelope proof matches its current model reference.
     * @param {unknown} document Document candidate.
     * @returns {boolean} Whether the envelope carries a reusable proof.
     */
    static has(document) {
        const proof = document?.[VALIDATION_PROOF]
        return CircuitJsonValidationToken.matches(proof, document?.model)
    }

    /**
     * Creates context-owned indexer options branded by a matching proof.
     * @param {Record<string, any>} document Proven document envelope.
     * @param {string[] | null} [families] Requested index work families.
     * @returns {{ validated: true, families: string[] | null }} Trusted indexer options.
     */
    static indexOptions(document, families = null) {
        if (!CircuitJsonValidationProof.has(document)) {
            throw new TypeError(
                'Validated index access requires a matching document proof.'
            )
        }

        const normalizedFamilies = Array.isArray(families)
            ? Object.freeze([...new Set(families.map(String))])
            : null
        const options = { validated: true, families: normalizedFamilies }
        Object.defineProperty(options, VALIDATED_INDEX_ACCESS, {
            enumerable: false,
            value: document[VALIDATION_PROOF]
        })
        return Object.freeze(options)
    }

    /**
     * Returns true only for an index request branded by a matching proof.
     * @param {unknown} model CircuitJSON model candidate.
     * @param {unknown} options Indexer options candidate.
     * @returns {boolean} Whether public validation may be skipped.
     */
    static permitsIndex(model, options) {
        const proof = options?.[VALIDATED_INDEX_ACCESS]
        return Boolean(
            options?.validated === true &&
            CircuitJsonValidationToken.matches(proof, model)
        )
    }

    /**
     * Returns trusted requested index families or null for the legacy full index.
     * @param {unknown} model CircuitJSON model candidate.
     * @param {unknown} options Indexer options candidate.
     * @returns {string[] | null} Requested families, or null for full work.
     */
    static indexFamilies(model, options) {
        if (!CircuitJsonValidationProof.permitsIndex(model, options)) {
            return null
        }
        return Array.isArray(options.families) ? options.families : null
    }
}
