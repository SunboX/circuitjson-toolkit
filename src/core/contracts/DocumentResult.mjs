import { CircuitJsonDocument } from '../CircuitJsonDocument.mjs'
import { CircuitJsonValidationProof } from '../context/CircuitJsonValidationProof.mjs'
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
        const source = DocumentResult.#source(fields)
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
                fields.extensions
            ),
            assets: Array.isArray(fields.assets)
                ? fields.assets.map((asset) => ToolkitAsset.create(asset))
                : [],
            diagnostics: Array.isArray(fields.diagnostics)
                ? fields.diagnostics.map((diagnostic) =>
                      ToolkitDiagnostic.create(diagnostic)
                  )
                : [],
            statistics: cloneSafeValue(fields.statistics, {})
        }
    }

    /**
     * Creates a canonical envelope whose model is validated and immutable.
     * @param {Record<string, any>} [fields] Document fields.
     * @returns {Record<string, any>} Proven canonical document result.
     */
    static createValidated(fields = {}) {
        const model = fields.model === undefined ? [] : fields.model
        CircuitJsonDocument.assertModel(model, { freeze: true })
        return CircuitJsonValidationProof.attach(
            DocumentResult.create({ ...fields, model })
        )
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
     * @returns {Record<string, any>} Normalized extension map.
     */
    static extensionForSource(format, extensions) {
        if (format === 'circuitjson') return {}
        const candidate = extensions?.[format]
        const hasCandidate = candidate && typeof candidate === 'object'
        const cloned = hasCandidate ? cloneSafeValue(candidate, {}) : {}
        const metadata = cloned.$meta || {}
        delete cloned.$meta
        return {
            [format]: {
                $meta: {
                    schema: String(metadata.schema || EXTENSION_SCHEMA),
                    completeness: String(
                        metadata.completeness ||
                            (hasCandidate ? 'canonical' : 'none')
                    ),
                    included: Array.isArray(metadata.included)
                        ? metadata.included.map(String)
                        : [],
                    omitted: Array.isArray(metadata.omitted)
                        ? metadata.omitted.map(String)
                        : []
                },
                ...cloned
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
