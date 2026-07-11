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
        const id = String(
            fields.id || DocumentResult.sourceId('project', source)
        )
        return {
            schema: 'ecad-toolkit.project.v1',
            id,
            source,
            documents,
            project:
                fields.project == null
                    ? null
                    : ProjectResult.#project(
                          fields.project,
                          id,
                          source,
                          documentIds
                      ),
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
     * Normalizes a present project descriptor to the exact common shape.
     * @param {unknown} project Project candidate.
     * @param {string} resultId Project-result id.
     * @param {Record<string, any>} source Normalized project source.
     * @param {string[]} documentIds Loaded document ids.
     * @returns {{ id: string, name: string, format: string, documentIds: string[], relationships: object[] }} Canonical project descriptor.
     */
    static #project(project, resultId, source, documentIds) {
        const provided = cloneSafeValue(project, {})
        return {
            id: String(provided.id || `${resultId}-project`),
            name: String(provided.name || ''),
            format: String(provided.format || source.format),
            documentIds,
            relationships: Array.isArray(provided.relationships)
                ? provided.relationships
                : []
        }
    }

    /**
     * Normalizes project source identity.
     * @param {unknown} source Source candidate.
     * @param {Record<string, any>[]} documents Project documents.
     * @returns {{ format: string, entryNames: string[] } & Record<string, any>} Normalized source.
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
