import { CircuitJsonDocumentContext } from './context/CircuitJsonDocumentContext.mjs'
import { PcbPrimitivePreparation } from './context/PcbPrimitivePreparation.mjs'
import { CanonicalInteractionOptions } from './interaction/CanonicalInteractionOptions.mjs'
import { PcbBoundsSelectionModel } from './PcbBoundsSelectionModel.mjs'
import { PcbCandidateSelectionModel } from './PcbCandidateSelectionModel.mjs'
import { PcbDiagnosticFocusModel } from './PcbDiagnosticFocusModel.mjs'
import { PcbInteractionPrimitiveModel } from './PcbInteractionPrimitiveModel.mjs'

const PRIMITIVE_CACHE = ['pcb', 'interaction-primitives-v1']
const SPATIAL_CACHE = ['interaction', 'pcb-spatial-v2']

/**
 * Reuses a broad-phase index while retaining exact CircuitJSON hit predicates.
 */
export class PcbInteractionIndex {
    #candidateQueries = 0
    #context
    #defaults
    #diagnosticFocus = null
    #exactTests = 0
    #groups
    #model
    #primitivesByRecordId
    #spatial

    /**
     * Creates one bound reusable interaction index.
     * @param {unknown} document DocumentResult, CircuitJSON model, or context.
     * @param {Record<string, any>} [options] Reusable visibility defaults.
     * @returns {PcbInteractionIndex} Bound interaction index.
     */
    static create(document, options = {}) {
        const defaults = CanonicalInteractionOptions.normalize(options)
        const context = CircuitJsonDocumentContext.prepare(document)
        const model = PcbPrimitivePreparation.prepareInteraction(context)
        const preparedRecords = PcbInteractionIndex.#spatialRecords(model)
        const spatial = PcbPrimitivePreparation.prepareSpatial(
            context,
            model,
            () => preparedRecords.records
        )
        return new PcbInteractionIndex(
            context,
            model,
            spatial,
            preparedRecords.primitivesByRecordId,
            defaults
        )
    }

    /**
     * Creates one prepared interaction service instance.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @param {Record<string, any>} model Primitive model.
     * @param {PcbSpatialIndex} spatial Spatial index.
     * @param {Map<string, object>} primitivesByRecordId Stable primitive lookup.
     * @param {Record<string, any>} defaults Normalized defaults.
     */
    constructor(context, model, spatial, primitivesByRecordId, defaults) {
        this.#context = context
        this.#model = model
        this.#spatial = spatial
        this.#primitivesByRecordId = primitivesByRecordId
        this.#defaults = defaults
        this.#groups = model.groups || []
    }

    /**
     * Returns ordered canonical hit records for one board-space point.
     * @param {{ x: number, y: number }} point CircuitJSON millimeter point.
     * @param {Record<string, any>} [options] Per-query visibility options.
     * @returns {object[]} Clone-safe ordered hit records.
     */
    hitTest(point, options = {}) {
        const normalizedPoint = CanonicalInteractionOptions.point(point)
        const normalized = CanonicalInteractionOptions.normalize(
            options,
            this.#defaults
        )
        const records = this.#spatial.search(
            PcbInteractionIndex.#candidateBounds(
                normalizedPoint,
                normalized.tolerance
            )
        )
        this.#candidateQueries += 1
        this.#exactTests += records.length
        const exactRecords = records.map((record) => ({
            recordId: record.id,
            primitive: this.#primitivesByRecordId.get(record.id)
        }))
        return PcbInteractionPrimitiveModel.hitTestRecords(
            exactRecords,
            normalizedPoint,
            normalized,
            this.#groups
        ).map((hit) =>
            PcbInteractionIndex.#hitRecord(
                hit,
                this.#primitivesByRecordId.get(hit.recordId)
            )
        )
    }

    /**
     * Returns the highest-priority hit or null.
     * @param {{ x: number, y: number }} point CircuitJSON millimeter point.
     * @param {Record<string, any>} [options] Per-query visibility options.
     * @returns {object | null} First hit.
     */
    pick(point, options = {}) {
        return this.hitTest(point, options)[0] || null
    }

    /**
     * Resolves canonical area selection from prepared primitive bounds.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Board-space selection bounds.
     * @param {Record<string, any>} [options] Per-selection visibility options.
     * @returns {{ bounds: object | null, point: object | null, candidates: object[], selectedCandidate: object | null, componentKeys: string[], netNames: string[] }} Clone-safe selection result.
     */
    selectBounds(bounds, options = {}) {
        const normalized = CanonicalInteractionOptions.normalize(
            options,
            this.#defaults
        )
        const normalizedBounds = PcbBoundsSelectionModel.normalizeBounds(bounds)
        if (!normalizedBounds) {
            return PcbBoundsSelectionModel.resolvePrimitives(
                [],
                bounds,
                normalized
            )
        }
        const primitives = this.#spatial
            .search(normalizedBounds)
            .map((record) => this.#primitivesByRecordId.get(record.id))
        return PcbBoundsSelectionModel.resolvePrimitives(
            primitives,
            normalizedBounds,
            normalized
        )
    }

    /**
     * Alias for canonical area-selection terminology used by source toolkits.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds Board-space selection bounds.
     * @param {Record<string, any>} [options] Per-selection visibility options.
     * @returns {{ bounds: object | null, point: object | null, candidates: object[], selectedCandidate: object | null, componentKeys: string[], netNames: string[] }} Clone-safe selection result.
     */
    selectArea(bounds, options = {}) {
        return this.selectBounds(bounds, options)
    }

    /**
     * Resolves click/hover candidates and the legacy selected-candidate state.
     * @param {{ x: number, y: number }} point CircuitJSON millimeter point.
     * @param {Record<string, any>} [options] Per-query visibility options.
     * @returns {{ point: { x: number, y: number }, candidates: object[], componentCandidate: object | null, netCandidate: object | null, selectedCandidate: object | null }} Clone-safe selection state.
     */
    selectionAt(point, options = {}) {
        const normalizedPoint = CanonicalInteractionOptions.point(point)
        const candidates = this.hitTest(normalizedPoint, options)
        return {
            point: normalizedPoint,
            candidates,
            componentCandidate:
                PcbCandidateSelectionModel.componentCandidate(candidates),
            netCandidate: PcbCandidateSelectionModel.netCandidate(candidates),
            selectedCandidate:
                PcbCandidateSelectionModel.selectedCandidate(candidates)
        }
    }

    /**
     * Snaps a board-space point to the nearest prepared primitive anchor.
     * @param {{ x: number, y: number }} point CircuitJSON millimeter point.
     * @param {{ tolerance?: number }} [options] Snap tolerance options.
     * @returns {{ snapped: boolean, point: { x: number, y: number } }} Clone-safe snap result.
     */
    snap(point, options = {}) {
        const normalizedPoint = CanonicalInteractionOptions.point(point)
        const normalized = CanonicalInteractionOptions.normalize(options, {
            ...this.#defaults,
            tolerance: 0
        })
        return PcbInteractionPrimitiveModel.resolveSnapPointFromModel(
            this.#model,
            normalizedPoint,
            { tolerance: normalized.tolerance }
        )
    }

    /**
     * Returns physical and virtual layer rows from the lazy complete model.
     * @returns {{ physicalLayers: object[], virtualLayers: object[] }} Clone-safe layers.
     */
    resolveLayers() {
        const model = PcbPrimitivePreparation.prepareComplete(this.#context)
        return structuredClone({
            physicalLayers: model.layers,
            virtualLayers: model.virtualLayers || []
        })
    }

    /**
     * Resolves one diagnostic id to its legacy board focus row.
     * @param {string} diagnosticId Stable diagnostic id.
     * @returns {object | null} Clone-safe diagnostic focus row.
     */
    resolveDiagnosticFocus(diagnosticId) {
        if (typeof diagnosticId !== 'string') {
            throw new TypeError('Diagnostic focus ids must be strings.')
        }
        if (!this.#diagnosticFocus) {
            const model = PcbPrimitivePreparation.prepareComplete(this.#context)
            this.#diagnosticFocus = PcbDiagnosticFocusModel.buildPrepared(
                this.#context.model,
                model
            )
        }
        const focus = this.#diagnosticFocus.get(diagnosticId) || null
        return focus ? structuredClone(focus) : null
    }

    /**
     * Returns clone-safe construction and query counters.
     * @returns {Record<string, number>} Interaction statistics.
     */
    get statistics() {
        const statistics = this.#context.statistics
        return {
            validationPasses: statistics.validationPasses,
            primitiveBuilds:
                statistics.derivedBuilds[PRIMITIVE_CACHE.join(':')] || 0,
            spatialIndexBuilds:
                statistics.derivedBuilds[SPATIAL_CACHE.join(':')] || 0,
            completePrimitiveBuilds:
                statistics.derivedBuilds['render:pcb-primitives-v1'] || 0,
            candidateQueries: this.#candidateQueries,
            exactTests: this.#exactTests
        }
    }

    /**
     * Builds stable plain records for the broad phase.
     * @param {Record<string, any>} model Primitive model.
     * @returns {{ records: object[], primitivesByRecordId: Map<string, object> }} Spatial records and exact primitive lookup.
     */
    static #spatialRecords(model) {
        const records = []
        const primitivesByRecordId = new Map()
        for (const [ordinal, primitive] of (model.primitives || []).entries()) {
            const bounds =
                PcbInteractionPrimitiveModel.interactionBounds(primitive)
            if (!bounds) continue
            const id = `pcb-primitive:${ordinal}`
            records.push({
                id,
                bounds
            })
            primitivesByRecordId.set(id, primitive)
        }
        return { records, primitivesByRecordId }
    }

    /**
     * Expands point queries enough to cover exact local-axis tolerance after
     * arbitrary two-dimensional rotation plus floating-point boundary drift.
     * @param {{ x: number, y: number }} point Normalized query point.
     * @param {number} tolerance Exact narrow-phase tolerance.
     * @returns {number} Conservative broad-phase tolerance.
     */
    static #candidateTolerance(point, tolerance) {
        const magnitude = Math.max(
            1,
            Math.abs(point.x),
            Math.abs(point.y),
            tolerance
        )
        return tolerance * Math.SQRT2 + Number.EPSILON * magnitude * 16
    }

    /**
     * Builds a finite query rectangle without passing the conservative
     * expansion through the public spatial-index tolerance limit.
     * @param {{ x: number, y: number }} point Normalized query point.
     * @param {number} tolerance Exact narrow-phase tolerance.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Conservative finite query bounds.
     */
    static #candidateBounds(point, tolerance) {
        const expansion = PcbInteractionIndex.#candidateTolerance(
            point,
            tolerance
        )
        return {
            minX: Math.max(-Number.MAX_VALUE, point.x - expansion),
            minY: Math.max(-Number.MAX_VALUE, point.y - expansion),
            maxX: Math.min(Number.MAX_VALUE, point.x + expansion),
            maxY: Math.min(Number.MAX_VALUE, point.y + expansion)
        }
    }

    /**
     * Converts one legacy exact hit to the common clone-safe shape.
     * @param {object} hit Legacy exact hit.
     * @param {object | undefined} primitive Matching primitive.
     * @returns {object} Canonical hit record.
     */
    static #hitRecord(hit, primitive) {
        const source = primitive?.source || primitive?.sourceRoute || {}
        const elementType = String(source.type || '')
        const elementId = PcbInteractionIndex.#elementId(
            source,
            elementType,
            primitive
        )
        const bounds = PcbInteractionPrimitiveModel.interactionBounds(
            primitive
        ) || {
            minX: 0,
            minY: 0,
            maxX: 0,
            maxY: 0
        }
        return {
            elementId,
            primitiveId: String(primitive?.id || hit.id || ''),
            kind: String(primitive?.kind || hit.kind || ''),
            side: ['top', 'bottom'].includes(primitive?.side)
                ? primitive.side
                : null,
            layerId: String(primitive?.layer || hit.layer || ''),
            bounds: { ...bounds },
            distance: Number(hit.distance),
            componentId: String(
                primitive?.componentId || hit.componentId || ''
            ),
            componentKey: String(
                primitive?.componentKey || hit.componentKey || ''
            ),
            netName: String(primitive?.netName || hit.netName || ''),
            groupIds: [...(primitive?.groupIds || hit.groupIds || [])],
            source: {
                format: 'circuitjson',
                elementId,
                elementType
            }
        }
    }

    /**
     * Resolves the stable owning CircuitJSON element id.
     * @param {object} source Source element.
     * @param {string} elementType Source type.
     * @param {object | undefined} primitive Primitive.
     * @returns {string} Stable element id.
     */
    static #elementId(source, elementType, primitive) {
        const direct = source[elementType + '_id']
        if (typeof direct === 'string' && direct) return direct
        for (const [key, value] of Object.entries(source)) {
            if (key.endsWith('_id') && typeof value === 'string' && value) {
                return value
            }
        }
        return String(primitive?.id || '')
    }
}
