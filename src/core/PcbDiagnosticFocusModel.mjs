import { CircuitJsonIndexer } from './CircuitJsonIndexer.mjs'
import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'
import { PcbInteractionPrimitiveModel } from './PcbInteractionPrimitiveModel.mjs'
import { CircuitJsonDocumentContext } from './context/CircuitJsonDocumentContext.mjs'

/**
 * Resolves viewport focus targets for PCB diagnostic rows.
 */
export class PcbDiagnosticFocusModel {
    /**
     * Builds a diagnostic-id to focus-target map.
     * @param {object | object[]} documentModel Parsed PCB document.
     * @returns {Map<string, object>}
     */
    static build(documentModel) {
        let context
        try {
            context = CircuitJsonDocumentContext.prepare(documentModel)
        } catch {
            return new Map()
        }
        const model = PcbInteractionPrimitiveModel.build(context)
        return PcbDiagnosticFocusModel.buildPrepared(context, model)
    }

    /**
     * Builds focus rows from one already prepared complete primitive model.
     * @param {object | object[]} documentModel Parsed PCB document.
     * @param {object} model Complete primitive model.
     * @returns {Map<string, object>} Diagnostic focus rows.
     */
    static buildPrepared(documentModel, model) {
        const context = PcbDiagnosticFocusModel.#context(documentModel, model)
        const rows = new Map()

        for (const diagnostic of model.diagnostics || []) {
            const row = PcbDiagnosticFocusModel.#focusRow(diagnostic, context)
            if (row) rows.set(row.id, row)
        }

        return rows
    }

    /**
     * Builds a compact viewport target around a diagnostic center.
     * @param {{ point?: object, bounds?: object } | null | undefined} focus Diagnostic focus row.
     * @returns {{ x: number, y: number, width: number, height: number } | null}
     */
    static viewportBounds(focus) {
        const bounds = PcbDiagnosticFocusModel.#normalizeBounds(focus?.bounds)
        if (!bounds) return null
        const center =
            CircuitJsonUnits.optionalPoint(focus?.point) ||
            PcbDiagnosticFocusModel.#boundsCenter(bounds)
        const width = Math.min(Math.max(bounds.width, 0.4), 1)
        const height = Math.min(Math.max(bounds.height, 0.4), 0.6)

        return {
            x: PcbDiagnosticFocusModel.#rounded(center.x - width / 2),
            y: PcbDiagnosticFocusModel.#rounded(center.y - height / 2),
            width: PcbDiagnosticFocusModel.#rounded(width),
            height: PcbDiagnosticFocusModel.#rounded(height)
        }
    }

    /**
     * Builds lookup data for focus resolution.
     * @param {object | object[]} documentModel Parsed document.
     * @param {object} model Primitive model.
     * @returns {object}
     */
    static #context(documentModel, model) {
        const elements = PcbDiagnosticFocusModel.#elements(documentModel)
        const elementsById = new Map()
        for (const element of elements) {
            const id = CircuitJsonIndexer.getElementId(element)
            if (id) elementsById.set(id, element)
        }

        return {
            model,
            elements,
            elementsById,
            sourcePortToPcbPortIds:
                PcbDiagnosticFocusModel.#sourcePortToPcbPortIds(elements),
            primitivesById: new Map(
                (model.primitives || [])
                    .filter((primitive) => String(primitive.id || '').trim())
                    .map((primitive) => [String(primitive.id), primitive])
            )
        }
    }

    /**
     * Builds one diagnostic focus row.
     * @param {object} diagnostic Diagnostic row.
     * @param {object} context Focus context.
     * @returns {object | null}
     */
    static #focusRow(diagnostic, context) {
        const id = String(diagnostic.id || '').trim()
        if (!id) return null

        const element = context.elementsById.get(id) || null
        const relatedPrimitives = PcbDiagnosticFocusModel.#relatedPrimitives(
            diagnostic,
            element,
            context
        )
        const relatedBounds =
            PcbDiagnosticFocusModel.#mergeBounds(
                relatedPrimitives.map((primitive) => primitive.bounds)
            ) ||
            PcbDiagnosticFocusModel.#componentBounds(element, context.model)
        const bounds =
            relatedBounds ||
            PcbDiagnosticFocusModel.#normalizeBounds(diagnostic.bounds) ||
            PcbDiagnosticFocusModel.#pointBounds(diagnostic.point)
        if (!bounds) return null

        return {
            id,
            point: PcbDiagnosticFocusModel.#roundPoint(
                PcbDiagnosticFocusModel.#boundsCenter(bounds)
            ),
            bounds: PcbDiagnosticFocusModel.#viewportBounds(bounds),
            relatedPrimitiveIds: relatedPrimitives
                .map((primitive) => String(primitive.id || '').trim())
                .filter(Boolean)
                .sort()
        }
    }

    /**
     * Resolves primitives related to one diagnostic.
     * @param {object} diagnostic Diagnostic row.
     * @param {object | null} element Source diagnostic element.
     * @param {object} context Focus context.
     * @returns {object[]}
     */
    static #relatedPrimitives(diagnostic, element, context) {
        const ids = Array.isArray(diagnostic.relatedPrimitiveIds)
            ? diagnostic.relatedPrimitiveIds
            : []
        const direct = ids
            .map((id) => context.primitivesById.get(String(id || '').trim()))
            .filter(Boolean)
        if (direct.length) return direct

        const fields = PcbDiagnosticFocusModel.#relatedFields(element)
        const fieldPrimitives = (context.model.primitives || []).filter(
            (primitive) =>
                fields.some(([field, value]) =>
                    PcbDiagnosticFocusModel.#primitiveMatches(
                        primitive,
                        field,
                        value
                    )
                )
        )
        if (fieldPrimitives.length) return fieldPrimitives

        const sourcePortId = String(element?.source_port_id || '').trim()
        const pcbPortIds =
            context.sourcePortToPcbPortIds.get(sourcePortId) || []
        const sourcePortPrimitives = (context.model.primitives || []).filter(
            (primitive) =>
                pcbPortIds.some(
                    (id) =>
                        String(primitive.source?.pcb_port_id || '').trim() ===
                        id
                )
        )
        if (sourcePortPrimitives.length) return sourcePortPrimitives

        const sourceComponentId = String(
            element?.source_component_id || ''
        ).trim()
        if (!sourceComponentId) return []

        return (context.model.primitives || []).filter(
            (primitive) =>
                String(primitive.sourceComponentId || '').trim() ===
                sourceComponentId
        )
    }

    /**
     * Builds source element fields that can identify related primitives.
     * @param {object | null} element Source diagnostic element.
     * @returns {Array<[string, string]>}
     */
    static #relatedFields(element) {
        return [
            ['pcb_trace_id', [element?.pcb_trace_id, element?.pcb_trace_ids]],
            [
                'pcb_smtpad_id',
                [
                    element?.pcb_smtpad_id,
                    element?.pcb_smtpad_ids,
                    element?.pcb_pad_id,
                    element?.pcb_pad_ids
                ]
            ],
            ['pcb_via_id', [element?.pcb_via_id, element?.pcb_via_ids]],
            [
                'pcb_plated_hole_id',
                [element?.pcb_plated_hole_id, element?.pcb_plated_hole_ids]
            ],
            ['pcb_hole_id', [element?.pcb_hole_id, element?.pcb_hole_ids]],
            ['pcb_port_id', [element?.pcb_port_id, element?.pcb_port_ids]],
            [
                'pcb_component_id',
                [element?.pcb_component_id, element?.pcb_component_ids]
            ]
        ].flatMap(([field, values]) =>
            PcbDiagnosticFocusModel.#idValues(values).map((value) => [
                field,
                value
            ])
        )
    }

    /**
     * Normalizes scalar or array ID values.
     * @param {unknown[]} values Candidate values.
     * @returns {string[]}
     */
    static #idValues(values) {
        return [
            ...new Set(
                values
                    .flatMap((value) =>
                        Array.isArray(value) ? value : [value]
                    )
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
            )
        ]
    }

    /**
     * Returns true when a primitive is associated with a source field.
     * @param {object} primitive Primitive row.
     * @param {string} field Source id field.
     * @param {string} value Source id value.
     * @returns {boolean}
     */
    static #primitiveMatches(primitive, field, value) {
        if (field === 'pcb_trace_id') {
            return String(primitive.source?.pcb_trace_id || '').trim() === value
        }
        if (field === 'pcb_component_id') {
            return String(primitive.componentId || '').trim() === value
        }
        return String(primitive.source?.[field] || '').trim() === value
    }

    /**
     * Builds source-port to PCB-port id lookup data.
     * @param {object[]} elements Element rows.
     * @returns {Map<string, string[]>}
     */
    static #sourcePortToPcbPortIds(elements) {
        const map = new Map()
        for (const element of elements) {
            if (element?.type !== 'pcb_port') continue
            const sourcePortId = String(element.source_port_id || '').trim()
            const pcbPortId = String(element.pcb_port_id || '').trim()
            if (!sourcePortId || !pcbPortId) continue
            if (!map.has(sourcePortId)) map.set(sourcePortId, [])
            map.get(sourcePortId).push(pcbPortId)
        }
        return map
    }

    /**
     * Resolves component bounds when no primitive bounds are available.
     * @param {object | null} element Source diagnostic element.
     * @param {object} model Primitive model.
     * @returns {object | null}
     */
    static #componentBounds(element, model) {
        const componentId = String(element?.pcb_component_id || '').trim()
        if (!componentId) return null

        const component = (model.components || []).find(
            (row) => String(row.pcbComponentId || '').trim() === componentId
        )
        if (!component) return null

        return PcbDiagnosticFocusModel.#centerBounds(
            { x: component.x, y: component.y },
            CircuitJsonUnits.length(component.width, 0.8),
            CircuitJsonUnits.length(component.height, 0.8)
        )
    }

    /**
     * Reads element rows from an array or wrapper object.
     * @param {object | object[]} documentModel Parsed document.
     * @returns {object[]}
     */
    static #elements(documentModel) {
        try {
            return CircuitJsonDocumentContext.prepare(documentModel).model
        } catch {
            // Preserve the tolerant legacy wrapper fallbacks below.
        }
        if (Array.isArray(documentModel)) return documentModel
        if (Array.isArray(documentModel?.elements))
            return documentModel.elements
        if (Array.isArray(documentModel?.circuitJson)) {
            return documentModel.circuitJson
        }
        return []
    }

    /**
     * Normalizes min/max bounds.
     * @param {object | null | undefined} bounds Bounds candidate.
     * @returns {object | null}
     */
    static #normalizeBounds(bounds) {
        if (!bounds) return null
        const minX = Number(bounds.minX ?? bounds.x)
        const minY = Number(bounds.minY ?? bounds.y)
        const width = Number(bounds.width)
        const height = Number(bounds.height)
        const maxX = Number(bounds.maxX ?? minX + width)
        const maxY = Number(bounds.maxY ?? minY + height)
        if (
            ![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))
        ) {
            return null
        }
        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX,
            height: maxY - minY
        }
    }

    /**
     * Builds compact bounds around a diagnostic point.
     * @param {object | null | undefined} point Point candidate.
     * @returns {object | null}
     */
    static #pointBounds(point) {
        const normalized = CircuitJsonUnits.optionalPoint(point)
        return normalized
            ? PcbDiagnosticFocusModel.#centerBounds(normalized, 0.8, 0.8)
            : null
    }

    /**
     * Builds center-size bounds.
     * @param {{ x: number, y: number }} center Center point.
     * @param {number} width Width.
     * @param {number} height Height.
     * @returns {object}
     */
    static #centerBounds(center, width, height) {
        const minX = Number(center.x) - width / 2
        const minY = Number(center.y) - height / 2
        return {
            minX,
            minY,
            maxX: minX + width,
            maxY: minY + height,
            width,
            height
        }
    }

    /**
     * Merges min/max bounds rows.
     * @param {object[]} boundsRows Bounds rows.
     * @returns {object | null}
     */
    static #mergeBounds(boundsRows) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const candidate of boundsRows) {
            const bounds = PcbDiagnosticFocusModel.#normalizeBounds(candidate)
            if (!bounds) continue
            minX = Math.min(minX, bounds.minX)
            minY = Math.min(minY, bounds.minY)
            maxX = Math.max(maxX, bounds.maxX)
            maxY = Math.max(maxY, bounds.maxY)
        }
        if (!Number.isFinite(minX)) return null
        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX,
            height: maxY - minY
        }
    }

    /**
     * Resolves a bounds center.
     * @param {object} bounds Bounds row.
     * @returns {{ x: number, y: number }}
     */
    static #boundsCenter(bounds) {
        return {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2
        }
    }

    /**
     * Formats bounds for viewport controllers.
     * @param {object} bounds Bounds row.
     * @returns {{ x: number, y: number, width: number, height: number }}
     */
    static #viewportBounds(bounds) {
        return {
            x: PcbDiagnosticFocusModel.#rounded(bounds.minX),
            y: PcbDiagnosticFocusModel.#rounded(bounds.minY),
            width: PcbDiagnosticFocusModel.#rounded(bounds.width),
            height: PcbDiagnosticFocusModel.#rounded(bounds.height)
        }
    }

    /**
     * Rounds one point.
     * @param {{ x: number, y: number }} point Point row.
     * @returns {{ x: number, y: number }}
     */
    static #roundPoint(point) {
        return {
            x: PcbDiagnosticFocusModel.#rounded(point.x),
            y: PcbDiagnosticFocusModel.#rounded(point.y)
        }
    }

    /**
     * Rounds a numeric value for stable comparisons.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #rounded(value) {
        return Number(Number(value).toFixed(6))
    }
}
