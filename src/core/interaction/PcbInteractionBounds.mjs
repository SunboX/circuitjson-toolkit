/**
 * Resolves conservative broad-phase bounds from every exact geometry signal.
 */
export class PcbInteractionBounds {
    /**
     * Unions stored, point-list, segment-stroke, and rotated shape bounds.
     * @param {object} primitive Prepared PCB primitive.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null} Conservative bounds.
     */
    static resolve(primitive) {
        const stored = PcbInteractionBounds.#bounds(primitive?.bounds)
        const points = (
            Array.isArray(primitive?.points) ? primitive.points : []
        )
            .map(PcbInteractionBounds.#point)
            .filter(Boolean)
        const pointBounds = points.length
            ? PcbInteractionBounds.#pointBounds(points)
            : null
        const segment = PcbInteractionBounds.#segmentBounds(primitive)
        const shape = PcbInteractionBounds.#rotatedShapeBounds(primitive)
        const signals = [stored, pointBounds, segment, shape].filter(Boolean)
        return signals.length ? PcbInteractionBounds.#merge(signals) : null
    }

    /**
     * Resolves stroke-expanded explicit segment bounds.
     * @param {object} primitive Primitive candidate.
     * @returns {object | null} Segment bounds.
     */
    static #segmentBounds(primitive) {
        const start = PcbInteractionBounds.#point({
            x: primitive?.x1,
            y: primitive?.y1
        })
        const end = PcbInteractionBounds.#point({
            x: primitive?.x2,
            y: primitive?.y2
        })
        if (!start || !end) return null
        const halfWidth = Math.max(
            PcbInteractionBounds.#number(primitive?.width, 0) / 2,
            0
        )
        return {
            minX: Math.min(start.x, end.x) - halfWidth,
            minY: Math.min(start.y, end.y) - halfWidth,
            maxX: Math.max(start.x, end.x) + halfWidth,
            maxY: Math.max(start.y, end.y) + halfWidth
        }
    }

    /**
     * Resolves an axis-aligned envelope for one rotated center-size shape.
     * @param {object} primitive Primitive candidate.
     * @returns {object | null} Rotated shape bounds.
     */
    static #rotatedShapeBounds(primitive) {
        const center = PcbInteractionBounds.#point(primitive)
        const width = PcbInteractionBounds.#finite(
            primitive?.width ?? primitive?.diameter
        )
        const height = PcbInteractionBounds.#finite(
            primitive?.height ?? primitive?.diameter ?? primitive?.width
        )
        if (!center || width === null || height === null) return null
        const radians =
            (PcbInteractionBounds.#number(primitive?.rotation, 0) * Math.PI) /
            180
        const cos = Math.abs(Math.cos(radians))
        const sin = Math.abs(Math.sin(radians))
        const halfWidth = (Math.abs(width) * cos + Math.abs(height) * sin) / 2
        const halfHeight = (Math.abs(width) * sin + Math.abs(height) * cos) / 2
        return {
            minX: center.x - halfWidth,
            minY: center.y - halfHeight,
            maxX: center.x + halfWidth,
            maxY: center.y + halfHeight
        }
    }

    /**
     * Resolves minimal bounds for normalized points.
     * @param {{ x: number, y: number }[]} points Normalized points.
     * @returns {object} Point bounds.
     */
    static #pointBounds(points) {
        return points.reduce(
            (bounds, point) => ({
                minX: Math.min(bounds.minX, point.x),
                minY: Math.min(bounds.minY, point.y),
                maxX: Math.max(bounds.maxX, point.x),
                maxY: Math.max(bounds.maxY, point.y)
            }),
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        )
    }

    /**
     * Unions normalized bounds rows.
     * @param {object[]} rows Bounds rows.
     * @returns {object} Merged bounds.
     */
    static #merge(rows) {
        return rows.reduce(
            (bounds, row) => ({
                minX: Math.min(bounds.minX, row.minX),
                minY: Math.min(bounds.minY, row.minY),
                maxX: Math.max(bounds.maxX, row.maxX),
                maxY: Math.max(bounds.maxY, row.maxY)
            }),
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        )
    }

    /**
     * Normalizes a point candidate.
     * @param {unknown} value Point candidate.
     * @returns {{ x: number, y: number } | null} Point or null.
     */
    static #point(value) {
        const x = PcbInteractionBounds.#finite(value?.x)
        const y = PcbInteractionBounds.#finite(value?.y)
        return x === null || y === null ? null : { x, y }
    }

    /**
     * Normalizes ordered rectangle bounds.
     * @param {unknown} value Bounds candidate.
     * @returns {object | null} Bounds or null.
     */
    static #bounds(value) {
        const minX = PcbInteractionBounds.#finite(value?.minX)
        const minY = PcbInteractionBounds.#finite(value?.minY)
        const maxX = PcbInteractionBounds.#finite(value?.maxX)
        const maxY = PcbInteractionBounds.#finite(value?.maxY)
        return minX !== null &&
            minY !== null &&
            maxX !== null &&
            maxY !== null &&
            minX <= maxX &&
            minY <= maxY
            ? { minX, minY, maxX, maxY }
            : null
    }

    /**
     * Converts one value to a finite number or null.
     * @param {unknown} value Number candidate.
     * @returns {number | null} Finite number or null.
     */
    static #finite(value) {
        if (value === undefined || value === null || value === '') return null
        const number = Number(value)
        return Number.isFinite(number) ? number : null
    }

    /**
     * Converts one value to a finite number with fallback.
     * @param {unknown} value Number candidate.
     * @param {number} fallback Fallback number.
     * @returns {number} Finite number.
     */
    static #number(value, fallback) {
        return PcbInteractionBounds.#finite(value) ?? fallback
    }
}
