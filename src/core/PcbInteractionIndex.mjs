import { CircuitJsonPcbPrimitiveBuilder } from './CircuitJsonPcbPrimitiveBuilder.mjs'
import { CircuitJsonDocumentContext } from './context/CircuitJsonDocumentContext.mjs'
import { PcbSpatialIndex } from './context/PcbSpatialIndex.mjs'
import { CanonicalInteractionOptions } from './interaction/CanonicalInteractionOptions.mjs'
import { PcbInteractionPrimitiveModel } from './PcbInteractionPrimitiveModel.mjs'

const PRIMITIVE_CACHE = ['pcb', 'primitive-model-v1']
const SPATIAL_CACHE = ['interaction', 'pcb-spatial-v1']

/**
 * Reuses a broad-phase index while retaining exact CircuitJSON hit predicates.
 */
export class PcbInteractionIndex {
    #candidateQueries = 0
    #context
    #defaults
    #exactTests = 0
    #groups
    #model
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
        const model = context.getOrCreateDerived(...PRIMITIVE_CACHE, () =>
            CircuitJsonPcbPrimitiveBuilder.build(context.model)
        )
        const spatial = context.getOrCreateDerived(...SPATIAL_CACHE, () =>
            PcbSpatialIndex.create(PcbInteractionIndex.#spatialRecords(model))
        )
        return new PcbInteractionIndex(context, model, spatial, defaults)
    }

    /**
     * Creates one prepared interaction service instance.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @param {Record<string, any>} model Primitive model.
     * @param {PcbSpatialIndex} spatial Spatial index.
     * @param {Record<string, any>} defaults Normalized defaults.
     */
    constructor(context, model, spatial, defaults) {
        this.#context = context
        this.#model = model
        this.#spatial = spatial
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
        const records = this.#spatial.candidates(
            normalizedPoint,
            normalized.tolerance
        )
        this.#candidateQueries += 1
        this.#exactTests += records.length
        const primitives = records.map((record) => record.primitive)
        const byId = new Map(
            primitives.map((primitive) => [
                String(primitive.id || ''),
                primitive
            ])
        )
        return PcbInteractionPrimitiveModel.hitTestPrimitives(
            primitives,
            normalizedPoint,
            normalized,
            this.#groups
        ).map((hit) =>
            PcbInteractionIndex.#hitRecord(hit, byId.get(String(hit.id || '')))
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
            candidateQueries: this.#candidateQueries,
            exactTests: this.#exactTests
        }
    }

    /**
     * Builds stable plain records for the broad phase.
     * @param {Record<string, any>} model Primitive model.
     * @returns {object[]} Spatial records.
     */
    static #spatialRecords(model) {
        const counts = new Map()
        const records = []
        for (const primitive of model.primitives || []) {
            const bounds =
                PcbInteractionPrimitiveModel.interactionBounds(primitive)
            if (!bounds) continue
            const primitiveId = String(primitive.id || 'primitive')
            const occurrence = counts.get(primitiveId) || 0
            counts.set(primitiveId, occurrence + 1)
            records.push({
                id: occurrence ? `${primitiveId}#${occurrence}` : primitiveId,
                bounds,
                primitive
            })
        }
        return records
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
