import { CircuitJsonReadOnlyDocument } from './CircuitJsonReadOnlyDocument.mjs'
import { CircuitJsonValidationAuthority } from './CircuitJsonValidationAuthority.mjs'

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

Object.freeze(CircuitJsonValidationToken.prototype)
Object.freeze(CircuitJsonValidationToken)

/**
 * Owns runtime-only proof metadata for immutable CircuitJSON documents.
 */
export class CircuitJsonValidationProof {
    /**
     * Validates, freezes, and proves one canonical document envelope.
     * @param {Record<string, any>} document Canonical document envelope.
     * @param {{ standardBuiltins?: boolean }} [options] Proven metadata provenance.
     * @returns {Record<string, any>} The same read-only document envelope.
     */
    static validateAndAttach(document, options = {}) {
        const model = CircuitJsonValidationProof.#requireModelData(document)
        if (!CircuitJsonValidationProof.#matches(document, model)) {
            const errors =
                CircuitJsonValidationAuthority.validateAndFreeze(model)
            if (errors.length) throw new TypeError(errors[0])
            if (
                CircuitJsonValidationProof.#requireModelData(document) !== model
            ) {
                throw new TypeError(
                    'CircuitJSON document model changed during validation.'
                )
            }
            Object.defineProperty(document, VALIDATION_PROOF, {
                configurable: false,
                enumerable: false,
                value: new CircuitJsonValidationToken(
                    model,
                    VALIDATION_TOKEN_SECRET
                ),
                writable: false
            })
        }
        const readonlyDocument = CircuitJsonReadOnlyDocument.freezeValidated(
            document,
            model,
            options
        )
        if (
            CircuitJsonValidationProof.#requireModelData(readonlyDocument) !==
                model ||
            !CircuitJsonValidationProof.#matches(readonlyDocument, model)
        ) {
            throw new TypeError(
                'CircuitJSON document model changed while sealing its validation proof.'
            )
        }
        return readonlyDocument
    }

    /**
     * Returns true when an envelope proof matches its current model reference.
     * @param {unknown} document Document candidate.
     * @returns {boolean} Whether the envelope carries a reusable proof.
     */
    static has(document) {
        if (!document || typeof document !== 'object') return false
        const descriptor = Object.getOwnPropertyDescriptor(document, 'model')
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false
        const model = descriptor.value
        return CircuitJsonValidationProof.#matches(document, model)
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
            value: CircuitJsonValidationProof.#proof(document)
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

    /**
     * Tests one envelope proof against an already captured model reference.
     * @param {unknown} document Document candidate.
     * @param {unknown} model Captured model candidate.
     * @returns {boolean} Whether the proof is valid for that exact model.
     */
    static #matches(document, model) {
        return CircuitJsonValidationToken.matches(
            CircuitJsonValidationProof.#proof(document),
            model
        )
    }

    /**
     * Reads one validation proof through its own data descriptor.
     * @param {unknown} document Document candidate.
     * @returns {unknown} Captured proof value.
     */
    static #proof(document) {
        if (!document || typeof document !== 'object') return undefined
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(
                document,
                VALIDATION_PROOF
            )
        } catch {
            return undefined
        }
        return descriptor && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined
    }

    /**
     * Returns an envelope's stable own model data property.
     * @param {unknown} document Document candidate.
     * @returns {unknown} Captured model value.
     */
    static #requireModelData(document) {
        if (!document || typeof document !== 'object') {
            throw new TypeError(
                'CircuitJSON document model must be an own data property.'
            )
        }
        const descriptor = Object.getOwnPropertyDescriptor(document, 'model')
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(
                'CircuitJSON document model must be an own data property.'
            )
        }
        return descriptor.value
    }
}

Object.freeze(CircuitJsonValidationProof.prototype)
Object.freeze(CircuitJsonValidationProof)
