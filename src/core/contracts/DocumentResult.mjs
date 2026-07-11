import { CircuitJsonValidationProof } from '../context/CircuitJsonValidationProof.mjs'
import { CircuitJsonReadOnlyDocument } from '../context/CircuitJsonReadOnlyDocument.mjs'
import { CircuitJsonSerializedInputAudit } from '../CircuitJsonSerializedInputAudit.mjs'
import { ToolkitAsset } from './ToolkitAsset.mjs'
import { ToolkitDiagnostic, cloneSafeValue } from './ToolkitDiagnostic.mjs'

const DOCUMENT_SCHEMA = 'ecad-toolkit.document.v1'
const EXTENSION_SCHEMA = 'ecad-toolkit.extension.v1'

/**
 * Builds canonical document result envelopes.
 */
export class DocumentResult {
    /**
     * Creates one canonical document envelope without validating its model.
     * @param {Record<string, any>} [fields] Document fields.
     * @returns {Record<string, any>} Canonical document result.
     */
    static create(fields = {}) {
        return DocumentResult.#create(fields, false)
    }

    /**
     * Creates the common envelope with the requested extension ownership mode.
     * @param {Record<string, any>} fields Document fields.
     * @param {boolean} readonlyExtensions Whether to capture immutable extensions now.
     * @returns {Record<string, any>} Canonical document result.
     */
    static #create(fields, readonlyExtensions) {
        const source = DocumentResult.#source(fields)
        const audit = CircuitJsonSerializedInputAudit.inspect(
            fields.model,
            source.fileName
        )
        return {
            schema: DOCUMENT_SCHEMA,
            id: String(
                fields.id || DocumentResult.sourceId('document', source)
            ),
            modelSchema: {
                name: 'circuit-json',
                version: '0.0.446'
            },
            model: Array.isArray(fields.model) ? fields.model : [],
            source,
            extensions: DocumentResult.extensionForSource(
                source.format,
                fields.extensions,
                { readonly: readonlyExtensions }
            ),
            assets: Array.isArray(fields.assets)
                ? fields.assets.map((asset) =>
                      CircuitJsonReadOnlyDocument.protectOwnedAsset(
                          ToolkitAsset.create(asset)
                      )
                  )
                : [],
            diagnostics: [
                ...(Array.isArray(fields.diagnostics)
                    ? fields.diagnostics
                    : []),
                ...audit.diagnostics
            ].map((diagnostic) => ToolkitDiagnostic.create(diagnostic)),
            statistics: {
                ...cloneSafeValue(fields.statistics, {}),
                ...audit.statistics
            }
        }
    }

    /**
     * Creates a canonical envelope whose model is validated and immutable.
     * @param {Record<string, any>} [fields] Document fields.
     * @param {{ sourceReference?: object }} [runtime] Runtime-only fields.
     * @returns {Record<string, any>} Proven canonical document result.
     */
    static createValidated(fields = {}, runtime = {}) {
        const document = DocumentResult.#create(fields, true)
        if (Object.hasOwn(runtime || {}, 'sourceReference')) {
            Object.defineProperty(document, 'sourceReference', {
                configurable: false,
                enumerable: false,
                value: runtime.sourceReference,
                writable: false
            })
        }
        return CircuitJsonValidationProof.validateAndAttach(document)
    }

    /**
     * Creates a stable id from normalized source identity only.
     * @param {string} prefix Id prefix.
     * @param {Record<string, any>} source Normalized source.
     * @returns {string} Stable source id.
     */
    static sourceId(prefix, source) {
        const identity = JSON.stringify({
            format: source.format,
            fileName: source.fileName || '',
            entryNames: Array.isArray(source.entryNames)
                ? [...source.entryNames].sort()
                : []
        })
        let hash = 2166136261
        for (const character of identity) {
            hash ^= character.codePointAt(0)
            hash = Math.imul(hash, 16777619)
        }
        return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`
    }

    /**
     * Selects and normalizes the extension namespace owned by a source.
     * @param {string} format Source format.
     * @param {unknown} extensions Extension candidates.
     * @param {{ readonly?: boolean }} [options] Extension ownership options.
     * @returns {Record<string, any>} Normalized extension map.
     */
    static extensionForSource(format, extensions, options = {}) {
        if (format === 'circuitjson') return {}
        const candidate = extensions?.[format]
        const hasCandidate = candidate && typeof candidate === 'object'
        if (!hasCandidate) return {}
        if (options.readonly === true && hasCandidate) {
            return CircuitJsonReadOnlyDocument.copyReadonlyExtensionValue(
                candidate,
                (snapshot) =>
                    DocumentResult.#normalizedExtension(format, snapshot)
            )
        }
        const cloned = hasCandidate ? cloneSafeValue(candidate, {}) : {}
        return DocumentResult.#normalizedExtension(format, cloned)
    }

    /**
     * Normalizes one already-owned source namespace without another deep copy.
     * @param {string} format Source format.
     * @param {Record<string, any>} namespace Owned mutable namespace.
     * @returns {Record<string, any>} Normalized extension map.
     */
    static #normalizedExtension(format, namespace) {
        const metadata = namespace.$meta || {}
        const fields = { ...namespace }
        delete fields.$meta
        return {
            [format]: {
                $meta: {
                    schema: String(metadata.schema || EXTENSION_SCHEMA),
                    completeness: String(metadata.completeness || 'canonical'),
                    included: Array.isArray(metadata.included)
                        ? metadata.included.map(String)
                        : [],
                    omitted: Array.isArray(metadata.omitted)
                        ? metadata.omitted.map(String)
                        : []
                },
                ...fields
            }
        }
    }

    /**
     * Normalizes document source identity and type.
     * @param {Record<string, any>} fields Document fields.
     * @returns {Record<string, any>} Normalized source.
     */
    static #source(fields) {
        const provided = cloneSafeValue(fields.source, {})
        const fileName = DocumentResult.#fileName(
            provided.fileName || fields.fileName
        )
        const format = String(
            provided.format || fields.format || 'circuitjson'
        ).toLowerCase()
        const suffix = fileName.split('.').pop()
        return {
            ...provided,
            format,
            fileName,
            fileType: String(
                provided.fileType ||
                    fields.fileType ||
                    (suffix && suffix !== fileName ? suffix : 'json')
            ).toLowerCase()
        }
    }

    /**
     * Normalizes path separators without resolving filesystem paths.
     * @param {unknown} fileName File name candidate.
     * @returns {string} Normalized source file name.
     */
    static #fileName(fileName) {
        return String(fileName || '')
            .replaceAll('\\', '/')
            .replace(/^\.\//u, '')
    }
}
