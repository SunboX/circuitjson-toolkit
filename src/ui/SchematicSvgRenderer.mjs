import { CircuitJsonDocumentContext } from '../core/context/CircuitJsonDocumentContext.mjs'
import { ToolkitError } from '../core/contracts/ToolkitError.mjs'
import { CanonicalRenderOptions } from '../core/rendering/CanonicalRenderOptions.mjs'
import { CanonicalSvgDocument } from '../core/rendering/CanonicalSvgDocument.mjs'
import { SchematicSheetSelector } from '../core/rendering/SchematicSheetSelector.mjs'
import { CircuitJsonSchematicSvgRenderer } from './CircuitJsonSchematicSvgRenderer.mjs'

const PREPARED_SCHEMATIC_SVGS = new WeakMap()

/**
 * Renders canonical CircuitJSON schematic documents through shared indexes.
 */
export class SchematicSvgRenderer {
    /**
     * Renders one schematic sheet as deterministic SVG.
     * @param {unknown} document DocumentResult, CircuitJSON model, or context.
     * @param {Record<string, any>} [options] Canonical render options.
     * @returns {string} SVG markup.
     */
    static render(document, options = {}) {
        const normalized = CanonicalRenderOptions.normalize(options, {
            sheetId: true,
            svg: true
        })
        CanonicalRenderOptions.requireCanonicalFidelity(normalized.fidelity)
        const context = CircuitJsonDocumentContext.prepare(document, {
            indexes: ['elements']
        })
        SchematicSvgRenderer.#requireSheet(context.model, normalized.sheetId)
        const sheetId = SchematicSvgRenderer.#resolveSheetId(
            context.model,
            normalized.sheetId
        )
        const key = `schematic-svg-v1:${sheetId || '*'}`
        const cached = context.getOrCreateDerived('render', key, () => {
            const index = context.getIndex('elements')
            const selected = sheetId
                ? SchematicSheetSelector.select(index, sheetId)
                : index
            const entry = Object.freeze({
                svg: CircuitJsonSchematicSvgRenderer.render(selected)
            })
            PREPARED_SCHEMATIC_SVGS.set(entry, { context, key })
            return entry
        })
        if (
            !cached ||
            typeof cached !== 'object' ||
            PREPARED_SCHEMATIC_SVGS.get(cached)?.context !== context ||
            PREPARED_SCHEMATIC_SVGS.get(cached)?.key !== key
        ) {
            throw CanonicalRenderOptions.error(
                'Schematic rendering encountered a derived-cache collision.'
            )
        }
        return CanonicalSvgDocument.decorate(cached.svg, normalized.svg)
    }

    /**
     * Requires a requested CircuitJSON schematic sheet to exist.
     * @param {object[]} model CircuitJSON model.
     * @param {string | null} sheetId Requested sheet id.
     * @returns {void}
     */
    static #requireSheet(model, sheetId) {
        if (
            !sheetId ||
            model.some(
                (element) =>
                    element.type === 'schematic_sheet' &&
                    element.schematic_sheet_id === sheetId
            )
        ) {
            return
        }
        throw new ToolkitError(`Unknown schematic sheet: ${sheetId}.`, {
            code: 'ERR_RENDER_SHEET',
            category: 'validation',
            format: 'circuitjson',
            details: { sheetId }
        })
    }

    /**
     * Resolves an explicit sheet or the first stable CircuitJSON sheet.
     * @param {object[]} model CircuitJSON model.
     * @param {string | null} requestedSheetId Explicit sheet id.
     * @returns {string | null} Selected sheet id.
     */
    static #resolveSheetId(model, requestedSheetId) {
        if (requestedSheetId) return requestedSheetId
        const sheets = model
            .filter((element) => element.type === 'schematic_sheet')
            .sort((left, right) => {
                const leftIndex = Number.isFinite(left.sheet_index)
                    ? left.sheet_index
                    : Infinity
                const rightIndex = Number.isFinite(right.sheet_index)
                    ? right.sheet_index
                    : Infinity
                if (leftIndex !== rightIndex) return leftIndex - rightIndex
                const leftId = String(left.schematic_sheet_id || '')
                const rightId = String(right.schematic_sheet_id || '')
                return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
            })
        return sheets[0]?.schematic_sheet_id || null
    }
}
