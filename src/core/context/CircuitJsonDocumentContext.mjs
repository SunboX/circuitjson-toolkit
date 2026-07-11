import { DocumentResult } from '../contracts/DocumentResult.mjs'
import { CircuitJsonContextIndexes } from './CircuitJsonContextIndexes.mjs'
import { CircuitJsonDerivedCache } from './CircuitJsonDerivedCache.mjs'
import { CircuitJsonValidationProof } from './CircuitJsonValidationProof.mjs'

const DOCUMENT_SCHEMA = 'ecad-toolkit.document.v1'

/**
 * Owns one immutable CircuitJSON model and its request-scoped reusable data.
 */
export class CircuitJsonDocumentContext {
    #derived
    #document
    #indexes
    #model
    #statistics

    /**
     * Creates a context from a proven document envelope.
     * @param {Record<string, any>} document Proven document envelope.
     * @param {number} validationPasses Validation passes performed by prepare.
     */
    constructor(document, validationPasses) {
        this.#document = document
        this.#model = document.model
        this.#statistics = {
            validationPasses,
            indexBuilds: {},
            derivedBuilds: {}
        }
        this.#indexes = new CircuitJsonContextIndexes(
            document,
            this.#statistics.indexBuilds
        )
        this.#derived = new CircuitJsonDerivedCache(
            this.#statistics.derivedBuilds
        )
    }

    /**
     * Prepares a document or extends an existing context with named indexes.
     * @param {unknown} input Document result, CircuitJSON model, or context.
     * @param {{ indexes?: unknown }} [options] Requested context options.
     * @returns {CircuitJsonDocumentContext} Prepared request-scoped context.
     */
    static prepare(input, options = {}) {
        const context =
            input instanceof CircuitJsonDocumentContext
                ? input
                : CircuitJsonDocumentContext.#fromInput(input)
        context.#indexes.ensure(options?.indexes || [])
        return context
    }

    /**
     * Returns the originating canonical document envelope.
     * @returns {Record<string, any>} Document envelope.
     */
    get document() {
        return this.#document
    }

    /**
     * Returns the immutable CircuitJSON model.
     * @returns {object[]} CircuitJSON model.
     */
    get model() {
        return this.#model
    }

    /**
     * Returns the document source metadata.
     * @returns {Record<string, any>} Source metadata.
     */
    get source() {
        return this.#document.source
    }

    /**
     * Returns the source-owned document extensions.
     * @returns {Record<string, any>} Extension map.
     */
    get extensions() {
        return this.#document.extensions
    }

    /**
     * Returns the document assets.
     * @returns {object[]} Asset records.
     */
    get assets() {
        return this.#document.assets
    }

    /**
     * Returns a clone-safe snapshot of context work counters.
     * @returns {{ validationPasses: number, indexBuilds: Record<string, number>, derivedBuilds: Record<string, number> }} Context statistics.
     */
    get statistics() {
        return {
            validationPasses: this.#statistics.validationPasses,
            indexBuilds: { ...this.#statistics.indexBuilds },
            derivedBuilds: { ...this.#statistics.derivedBuilds }
        }
    }

    /**
     * Returns one named index, creating it when first requested.
     * @param {unknown} name Requested index name.
     * @returns {Record<string, any>} Prepared index.
     */
    getIndex(name) {
        return this.#indexes.get(name)
    }

    /**
     * Returns true when one named index is already prepared.
     * @param {unknown} name Requested index name.
     * @returns {boolean} Whether the named index exists.
     */
    hasIndex(name) {
        return this.#indexes.has(name)
    }

    /**
     * Returns or creates one request-scoped derived value.
     * @param {unknown} namespace Cache namespace.
     * @param {unknown} key Cache key.
     * @param {() => any} factory Value factory.
     * @returns {any} Cached or newly built value.
     */
    getOrCreateDerived(namespace, key, factory) {
        return this.#derived.getOrCreate(
            String(namespace),
            String(key),
            factory
        )
    }

    /**
     * Returns whether a derived object belongs to this exact context key.
     * @param {unknown} namespace Cache namespace.
     * @param {unknown} key Cache key.
     * @param {unknown} value Derived value candidate.
     * @returns {boolean} Whether exact cache ownership matches.
     * @internal
     */
    ownsDerived(namespace, key, value) {
        return this.#derived.owns(String(namespace), String(key), value)
    }

    /**
     * Creates one context and establishes a matching immutable model proof.
     * @param {unknown} input Document result or CircuitJSON model.
     * @returns {CircuitJsonDocumentContext} New context.
     */
    static #fromInput(input) {
        const document = CircuitJsonDocumentContext.#normalizeDocument(input)
        const validationPasses = CircuitJsonValidationProof.has(document)
            ? 0
            : 1
        CircuitJsonValidationProof.validateAndAttach(document)
        return new CircuitJsonDocumentContext(document, validationPasses)
    }

    /**
     * Normalizes supported context input into a canonical document envelope.
     * @param {unknown} input Document result or CircuitJSON model.
     * @returns {Record<string, any>} Canonical document envelope.
     */
    static #normalizeDocument(input) {
        if (Array.isArray(input)) {
            return DocumentResult.create({
                fileName: input.fileName,
                fileType: input.fileType,
                model: input
            })
        }
        if (input?.schema === DOCUMENT_SCHEMA && Array.isArray(input.model)) {
            return input
        }
        throw new TypeError(
            'Expected a DocumentResult, CircuitJSON element array, or document context.'
        )
    }
}
