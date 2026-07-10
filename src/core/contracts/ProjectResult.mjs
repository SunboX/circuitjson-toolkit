import { DocumentResult } from './DocumentResult.mjs'
import { ToolkitAsset } from './ToolkitAsset.mjs'
import { ToolkitDiagnostic, cloneSafeValue } from './ToolkitDiagnostic.mjs'

/**
 * Builds canonical multi-document project envelopes.
 */
export class ProjectResult {
    /**
     * Creates one canonical project result.
     * @param {Record<string, any>} [fields] Project fields.
     * @returns {Record<string, any>} Canonical project result.
     */
    static create(fields = {}) {
        const documents = Array.isArray(fields.documents)
            ? fields.documents
            : []
        const source = ProjectResult.#source(fields.source, documents)
        const documentIds = documents.map((document) => String(document.id))
        const project = cloneSafeValue(fields.project, {})
        return {
            schema: 'ecad-toolkit.project.v1',
            id: String(fields.id || DocumentResult.sourceId('project', source)),
            source,
            documents,
            project: {
                ...project,
                documentIds
            },
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
     * Normalizes project source identity.
     * @param {unknown} source Source candidate.
     * @param {Record<string, any>[]} documents Project documents.
     * @returns {Record<string, any>} Normalized source.
     */
    static #source(source, documents) {
        const provided = cloneSafeValue(source, {})
        const entryNames = Array.isArray(provided.entryNames)
            ? provided.entryNames.map(String)
            : documents
                  .map((document) => document?.source?.fileName)
                  .filter(Boolean)
                  .map(String)
        return {
            ...provided,
            format: String(
                provided.format || documents[0]?.source?.format || 'circuitjson'
            ).toLowerCase(),
            entryNames
        }
    }
}
