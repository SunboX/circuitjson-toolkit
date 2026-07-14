import { DocumentResult } from '../contracts/DocumentResult.mjs'
import { CircuitJsonLegacyNormalizer } from './CircuitJsonLegacyNormalizer.mjs'
import { CircuitJsonContextIndexes } from './CircuitJsonContextIndexes.mjs'
import { CircuitJsonDerivedCache } from './CircuitJsonDerivedCache.mjs'
import { CircuitJsonReadOnlyDocument } from './CircuitJsonReadOnlyDocument.mjs'
import { CircuitJsonValidationProof } from './CircuitJsonValidationProof.mjs'

const DOCUMENT_SCHEMA = 'ecad-toolkit.document.v1'
const CONTEXT_CONSTRUCTION_AUTHORITY = Object.freeze({})

/**
 * Owns one immutable CircuitJSON model and its request-scoped reusable data.
 */
export class CircuitJsonDocumentContext {
    #derived
    #document
    #indexes
    #model
    #source
    #extensions
    #assets
    #statistics

    /**
     * Creates a context from a proven document envelope.
     * @param {Record<string, any>} document Proven document envelope.
     * @param {object[]} model Proven CircuitJSON model.
     * @param {number} validationPasses Validation passes performed by prepare.
     * @param {object} authority Module-private construction authority.
     */
    constructor(document, model, validationPasses, authority) {
        if (authority !== CONTEXT_CONSTRUCTION_AUTHORITY) {
            throw new TypeError(
                'Use CircuitJsonDocumentContext.prepare() to create a context.'
            )
        }
        this.#document = document
        this.#model = model
        this.#source = CircuitJsonReadOnlyDocument.copyReadonlyMetadataValue(
            CircuitJsonDocumentContext.#ownData(document, 'source', false) || {}
        )
        this.#extensions =
            CircuitJsonReadOnlyDocument.copyReadonlyMetadataValue(
                CircuitJsonDocumentContext.#ownData(
                    document,
                    'extensions',
                    false
                ) || {}
            )
        this.#assets = CircuitJsonDocumentContext.#ownData(
            document,
            'assets',
            false
        )
        this.#statistics = {
            validationPasses,
            indexBuilds: {},
            derivedBuilds: {}
        }
        this.#indexes = new CircuitJsonContextIndexes(
            document,
            model,
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
        return CircuitJsonDocumentContext.#prepare(input, options, false)
    }

    /**
     * Prepares a document whose platform built-ins were normalized by the
     * structured-clone algorithm.
     * @param {unknown} input Structured-cloned document result or existing context.
     * @param {{ indexes?: unknown }} [options] Requested context options.
     * @returns {CircuitJsonDocumentContext} Prepared request-scoped context.
     */
    static prepareStructuredClone(input, options = {}) {
        return CircuitJsonDocumentContext.#prepare(input, options, true)
    }

    /**
     * Prepares one context with explicit metadata provenance.
     * @param {unknown} input Document result, CircuitJSON model, or context.
     * @param {{ indexes?: unknown }} options Requested context options.
     * @param {boolean} standardBuiltins Whether metadata built-ins have standard local prototypes.
     * @returns {CircuitJsonDocumentContext} Prepared request-scoped context.
     */
    static #prepare(input, options, standardBuiltins) {
        const context = CircuitJsonDocumentContext.#isContext(input)
            ? input
            : CircuitJsonDocumentContext.#fromInput(input, standardBuiltins)
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
        return this.#source
    }

    /**
     * Returns the source-owned document extensions.
     * @returns {Record<string, any>} Extension map.
     */
    get extensions() {
        return this.#extensions
    }

    /**
     * Returns the document assets.
     * @returns {object[]} Asset records.
     */
    get assets() {
        return this.#assets
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
     * @param {boolean} standardBuiltins Whether metadata built-ins have standard local prototypes.
     * @returns {CircuitJsonDocumentContext} New context.
     */
    static #fromInput(input, standardBuiltins) {
        const document = CircuitJsonDocumentContext.#normalizeDocument(input)
        const validationPasses = CircuitJsonValidationProof.has(document)
            ? 0
            : 1
        const readonlyDocument = CircuitJsonValidationProof.validateAndAttach(
            document,
            {
                standardBuiltins
            }
        )
        const model = CircuitJsonDocumentContext.#ownData(
            readonlyDocument,
            'model'
        )
        return new CircuitJsonDocumentContext(
            readonlyDocument,
            model,
            validationPasses,
            CONTEXT_CONSTRUCTION_AUTHORITY
        )
    }

    /**
     * Normalizes supported context input into a canonical document envelope.
     * @param {unknown} input Document result or CircuitJSON model.
     * @returns {Record<string, any>} Canonical document envelope.
     */
    static #normalizeDocument(input) {
        if (Array.isArray(input)) {
            const fileType = CircuitJsonDocumentContext.#ownData(
                input,
                'fileType',
                false
            )
            return DocumentResult.create({
                fileName: CircuitJsonDocumentContext.#ownData(
                    input,
                    'fileName',
                    false
                ),
                fileType:
                    fileType ??
                    CircuitJsonDocumentContext.#ownData(input, 'kind', false),
                format:
                    CircuitJsonDocumentContext.#ownData(
                        input,
                        'sourceFormat',
                        false
                    ) ??
                    CircuitJsonDocumentContext.#ownData(input, 'format', false),
                model: CircuitJsonLegacyNormalizer.normalize(
                    CircuitJsonDocumentContext.#canonicalModel(input)
                )
            })
        }
        if (!input || typeof input !== 'object') {
            throw new TypeError(
                'Expected a DocumentResult, CircuitJSON element array, or document context.'
            )
        }
        const schema = CircuitJsonDocumentContext.#ownData(input, 'schema')
        const model = CircuitJsonDocumentContext.#ownData(input, 'model')
        if (schema === DOCUMENT_SCHEMA && Array.isArray(model)) {
            return input
        }
        throw new TypeError(
            'Expected a DocumentResult, CircuitJSON element array, or document context.'
        )
    }

    /**
     * Preserves pure model-array identity and removes enumerable legacy
     * metadata fields from hybrid arrays before validation.
     * @param {any[]} model CircuitJSON model array.
     * @returns {any[]} Pure dense model array.
     */
    static #canonicalModel(model) {
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(model)
            descriptors = Object.getOwnPropertyDescriptors(model)
        } catch {
            return model
        }
        const length = descriptors.length?.value
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0
        ) {
            return model
        }
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                return model
            }
        }
        const keys = Reflect.ownKeys(descriptors)
        if (keys.length === length + 1) return model
        for (const key of keys) {
            if (key === 'length') continue
            const index =
                typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key)
                    ? Number(key)
                    : -1
            if (Number.isSafeInteger(index) && index < length) continue
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                return model
            }
        }
        const canonical = new Array(length)
        for (let index = 0; index < length; index += 1) {
            canonical[index] = descriptors[String(index)].value
        }
        return canonical
    }

    /**
     * Detects genuine contexts through a private slot without proxy traps.
     * @param {unknown} value Context candidate.
     * @returns {boolean} Whether the private context slot is present.
     */
    static #isContext(value) {
        try {
            return Boolean(value.#document)
        } catch {
            return false
        }
    }

    /**
     * Reads one own data property without ordinary property access.
     * @param {object} owner Canonical envelope or model array.
     * @param {PropertyKey} key Property key.
     * @param {boolean} [required] Whether absence is rejected.
     * @returns {any} Own data value.
     */
    static #ownData(owner, key, required = true) {
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(owner, key)
        } catch {
            throw new TypeError(
                'CircuitJSON document properties could not be inspected safely.'
            )
        }
        if (!descriptor) {
            if (!required) return undefined
            throw new TypeError(
                `CircuitJSON document ${String(key)} must be an own data property.`
            )
        }
        if (!Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(
                `CircuitJSON document ${String(key)} must be an own data property.`
            )
        }
        return descriptor.value
    }
}
