import { PcbInteractionPrimitiveModel } from './PcbInteractionPrimitiveModel.mjs'
import { PcbCandidateSelectionModel } from './PcbCandidateSelectionModel.mjs'

/**
 * Resolves PCB primitives contained by a measured board-space rectangle.
 */
export class PcbBoundsSelectionModel {
    /**
     * Resolves contained candidates and unique component/net selections.
     * @param {object | object[]} documentModel Parsed PCB document model.
     * @param {{ minX?: unknown, minY?: unknown, maxX?: unknown, maxY?: unknown }} bounds Board-space bounds.
     * @param {{ side?: string, hiddenLayers?: string[], hiddenObjects?: string[] }} [options] Selection options.
     * @returns {{ bounds: object | null, point: object | null, candidates: object[], selectedCandidate: object | null, componentKeys: string[], netNames: string[] }}
     */
    static resolve(documentModel, bounds, options = {}) {
        return PcbBoundsSelectionModel.resolvePrimitives(
            PcbInteractionPrimitiveModel.build(documentModel).primitives,
            bounds,
            options
        )
    }

    /**
     * Resolves area selection from an already prepared primitive list.
     * @param {object[]} primitives Prepared PCB primitives.
     * @param {{ minX?: unknown, minY?: unknown, maxX?: unknown, maxY?: unknown }} bounds Board-space bounds.
     * @param {{ side?: string, hiddenLayers?: string[], hiddenObjects?: string[] }} [options] Selection options.
     * @returns {{ bounds: object | null, point: object | null, candidates: object[], selectedCandidate: object | null, componentKeys: string[], netNames: string[] }}
     */
    static resolvePrimitives(primitives, bounds, options = {}) {
        const normalizedBounds = PcbBoundsSelectionModel.normalizeBounds(bounds)
        if (!normalizedBounds) return PcbBoundsSelectionModel.#empty()

        const visibility = PcbBoundsSelectionModel.#visibilityOptions(options)
        const candidates = PcbBoundsSelectionModel.#containedPrimitives(
            primitives,
            normalizedBounds,
            visibility
        ).map((primitive) =>
            PcbCandidateSelectionModel.fromPrimitive(primitive)
        )
        const uniqueCandidates =
            PcbBoundsSelectionModel.#uniqueCandidates(candidates)
        const selectedCandidate =
            PcbCandidateSelectionModel.selectedCandidate(uniqueCandidates)

        return {
            bounds: normalizedBounds,
            point: PcbBoundsSelectionModel.#center(normalizedBounds),
            candidates: uniqueCandidates,
            selectedCandidate,
            componentKeys: PcbBoundsSelectionModel.#uniqueStrings(
                uniqueCandidates.map((candidate) => candidate.componentKey)
            ),
            netNames: PcbBoundsSelectionModel.#uniqueStrings(
                uniqueCandidates.map((candidate) =>
                    PcbCandidateSelectionModel.netName(candidate)
                )
            )
        }
    }

    /**
     * Normalizes board-space bounds.
     * @param {{ minX?: unknown, minY?: unknown, maxX?: unknown, maxY?: unknown } | null | undefined} bounds Bounds candidate.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number } | null}
     */
    static normalizeBounds(bounds) {
        const minX = PcbBoundsSelectionModel.#finite(bounds?.minX)
        const minY = PcbBoundsSelectionModel.#finite(bounds?.minY)
        const maxX = PcbBoundsSelectionModel.#finite(bounds?.maxX)
        const maxY = PcbBoundsSelectionModel.#finite(bounds?.maxY)
        if ([minX, minY, maxX, maxY].some((value) => value === null)) {
            return null
        }

        const left = Math.min(minX, maxX)
        const right = Math.max(minX, maxX)
        const top = Math.min(minY, maxY)
        const bottom = Math.max(minY, maxY)

        return {
            minX: left,
            minY: top,
            maxX: right,
            maxY: bottom,
            width: right - left,
            height: bottom - top
        }
    }

    /**
     * Builds an empty selection result.
     * @returns {{ bounds: null, point: null, candidates: object[], selectedCandidate: null, componentKeys: string[], netNames: string[] }}
     */
    static #empty() {
        return {
            bounds: null,
            point: null,
            candidates: [],
            selectedCandidate: null,
            componentKeys: [],
            netNames: []
        }
    }

    /**
     * Returns primitives that are visible and touch the measured bounds.
     * @param {object[]} primitives Prepared primitives.
     * @param {object} bounds Normalized bounds.
     * @param {object} options Selection options.
     * @returns {object[]}
     */
    static #containedPrimitives(primitives, bounds, options) {
        return (primitives || []).filter(
            (primitive) =>
                PcbBoundsSelectionModel.#isVisible(primitive, options) &&
                PcbBoundsSelectionModel.#touchesBounds(primitive, bounds)
        )
    }

    /**
     * Returns true when a primitive should participate in area selection.
     * @param {object} primitive Primitive row.
     * @param {{ side?: string, hiddenLayers?: string[], hiddenObjects?: string[] }} options Selection options.
     * @returns {boolean}
     */
    static #isVisible(primitive, options) {
        const side = options.side
        if (side && primitive.side && primitive.side !== side) return false

        if (
            primitive.layer &&
            options.hiddenLayers.has(String(primitive.layer))
        ) {
            return false
        }

        return !options.hiddenObjects.has(
            PcbBoundsSelectionModel.#objectKey(primitive)
        )
    }

    /**
     * Builds visibility lookup sets once for one area-selection operation.
     * @param {{ side?: string, hiddenLayers?: string[], hiddenObjects?: string[] }} options Raw options.
     * @returns {{ side: string, hiddenLayers: Set<string>, hiddenObjects: Set<string> }} Prepared visibility.
     */
    static #visibilityOptions(options) {
        return {
            side: String(options?.side || ''),
            hiddenLayers: new Set(
                (Array.isArray(options?.hiddenLayers)
                    ? options.hiddenLayers
                    : []
                )
                    .map(String)
                    .filter(Boolean)
            ),
            hiddenObjects: new Set(
                (Array.isArray(options?.hiddenObjects)
                    ? options.hiddenObjects
                    : []
                )
                    .map(String)
                    .filter(Boolean)
            )
        }
    }

    /**
     * Returns true when a primitive overlaps or sits inside bounds.
     * @param {object} primitive Primitive row.
     * @param {object} bounds Normalized bounds.
     * @returns {boolean}
     */
    static #touchesBounds(primitive, bounds) {
        const primitiveBounds =
            PcbBoundsSelectionModel.normalizeBounds(primitive?.bounds) ||
            PcbBoundsSelectionModel.#pointBounds(primitive)
        if (!primitiveBounds) return false

        return !(
            primitiveBounds.maxX < bounds.minX ||
            primitiveBounds.minX > bounds.maxX ||
            primitiveBounds.maxY < bounds.minY ||
            primitiveBounds.minY > bounds.maxY
        )
    }

    /**
     * Builds zero-area bounds around primitive center coordinates.
     * @param {object} primitive Primitive row.
     * @returns {object | null}
     */
    static #pointBounds(primitive) {
        const x = PcbBoundsSelectionModel.#finite(primitive?.x)
        const y = PcbBoundsSelectionModel.#finite(primitive?.y)
        if (x === null || y === null) return null
        return PcbBoundsSelectionModel.normalizeBounds({
            minX: x,
            minY: y,
            maxX: x,
            maxY: y
        })
    }

    /**
     * Deduplicates candidates by visible identity.
     * @param {object[]} candidates Candidate rows.
     * @returns {object[]}
     */
    static #uniqueCandidates(candidates) {
        const seen = new Set()
        const unique = []
        for (const candidate of candidates) {
            const key = [
                candidate.kind,
                candidate.componentKey,
                PcbCandidateSelectionModel.netName(candidate),
                candidate.layer
            ].join('|')
            if (seen.has(key)) continue
            seen.add(key)
            unique.push(candidate)
        }
        return unique
    }

    /**
     * Deduplicates non-empty strings in source order.
     * @param {string[]} values Candidate values.
     * @returns {string[]}
     */
    static #uniqueStrings(values) {
        return [
            ...new Set(values.map(String).map((value) => value.trim()))
        ].filter(Boolean)
    }

    /**
     * Resolves the sidebar object key for a primitive.
     * @param {object} primitive Primitive row.
     * @returns {string}
     */
    static #objectKey(primitive) {
        return (
            {
                board: 'page',
                cutout: 'page',
                pad: 'pads',
                track: 'tracks',
                via: 'vias',
                zone: 'zones',
                'copper-text': 'footprint-text',
                copper_text: 'footprint-text',
                silkscreen: 'footprint-text',
                silkscreen_text: 'footprint-text',
                fabrication: 'footprint-text'
            }[primitive?.kind] || String(primitive?.kind || '')
        )
    }

    /**
     * Resolves the center point for normalized bounds.
     * @param {object} bounds Normalized bounds.
     * @returns {{ x: number, y: number }}
     */
    static #center(bounds) {
        return {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        }
    }

    /**
     * Converts a value to a finite number or null.
     * @param {unknown} value Numeric candidate.
     * @returns {number | null}
     */
    static #finite(value) {
        if (value === undefined || value === null || value === '') return null
        const number = Number(value)
        return Number.isFinite(number) ? number : null
    }
}
