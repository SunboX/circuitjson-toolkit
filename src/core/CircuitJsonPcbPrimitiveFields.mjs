import { CircuitJsonIndexer } from './CircuitJsonIndexer.mjs'
import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'
import { CircuitJsonPcbPrimitiveGeometry } from './CircuitJsonPcbPrimitiveGeometry.mjs'

/**
 * Resolves shared CircuitJSON PCB primitive fields from common element shapes.
 */
export class CircuitJsonPcbPrimitiveFields {
    /**
     * Resolves board bounds from outline or size metadata.
     * @param {object | null} board Board element.
     * @returns {object | null}
     */
    static boardBounds(board) {
        const outline = CircuitJsonPcbPrimitiveFields.points(board)
        if (outline.length >= 3) {
            return CircuitJsonPcbPrimitiveGeometry.pointsBounds(outline)
        }

        const width = CircuitJsonUnits.optionalLength(board?.width)
        const height = CircuitJsonUnits.optionalLength(board?.height)
        if (width === null || height === null || width <= 0 || height <= 0) {
            return null
        }

        return CircuitJsonPcbPrimitiveGeometry.centerBounds(
            CircuitJsonPcbPrimitiveFields.center(board) || { x: 0, y: 0 },
            width,
            height
        )
    }

    /**
     * Resolves merged bounds for all board rows.
     * @param {object[]} boards Board rows.
     * @returns {object | null}
     */
    static mergedBoardBounds(boards) {
        return CircuitJsonPcbPrimitiveGeometry.mergedPrimitiveBounds(
            boards
                .map((board) => ({
                    bounds: CircuitJsonPcbPrimitiveFields.boardBounds(board)
                }))
                .filter((row) => row.bounds)
        )
    }

    /**
     * Builds copper layer rows from board metadata.
     * @param {object | null} board Board element.
     * @returns {object[]}
     */
    static layers(board) {
        const count = Math.max(
            1,
            Math.round(CircuitJsonUnits.length(board?.num_layers, 2))
        )
        const keys =
            count === 1
                ? ['top']
                : [
                      'top',
                      ...Array.from(
                          { length: Math.max(count - 2, 0) },
                          (_entry, index) => 'inner' + (index + 1)
                      ),
                      'bottom'
                  ]

        return keys.map((key, index) => ({
            key,
            id: key,
            layer: key,
            name: key,
            number: index + 1,
            side: key === 'top' ? 'top' : key === 'bottom' ? 'bottom' : 'inner',
            type: 'copper',
            sourceFormat: 'circuitjson'
        }))
    }

    /**
     * Resolves a center point.
     * @param {object} element Element row.
     * @returns {{ x: number, y: number } | null}
     */
    static center(element) {
        return CircuitJsonPcbPrimitiveFields.point(element?.center || element)
    }

    /**
     * Resolves one point.
     * @param {object | null | undefined} value Point candidate.
     * @returns {{ x: number, y: number } | null}
     */
    static point(value) {
        return CircuitJsonUnits.optionalPoint(value)
    }

    /**
     * Resolves polygon points from common fields.
     * @param {object} element Element row.
     * @returns {{ x: number, y: number }[]}
     */
    static points(element) {
        return (
            (Array.isArray(element?.points) && element.points) ||
            (Array.isArray(element?.outline) && element.outline) ||
            (Array.isArray(element?.vertices) && element.vertices) ||
            (Array.isArray(element?.route) && element.route) ||
            (Array.isArray(element?.path) && element.path) ||
            (Array.isArray(element?.shape?.points) && element.shape.points) ||
            []
        )
            .map((point) => CircuitJsonPcbPrimitiveFields.point(point))
            .filter(Boolean)
    }

    /**
     * Resolves open line/path points from common detail geometry fields.
     * @param {object} element Element row.
     * @returns {{ x: number, y: number }[]}
     */
    static linePoints(element) {
        const points = CircuitJsonPcbPrimitiveFields.points(element)
        if (points.length > 1) return points

        return [
            CircuitJsonPcbPrimitiveFields.point({
                x: element.x1 ?? element.start?.x,
                y: element.y1 ?? element.start?.y
            }),
            CircuitJsonPcbPrimitiveFields.point({
                x: element.x2 ?? element.end?.x,
                y: element.y2 ?? element.end?.y
            })
        ].filter(Boolean)
    }

    /**
     * Resolves the center of a point list.
     * @param {{ x: number, y: number }[]} points Points.
     * @returns {{ x: number, y: number } | null}
     */
    static pointsCenter(points) {
        const bounds = CircuitJsonPcbPrimitiveGeometry.pointsBounds(points)
        return bounds
            ? {
                  x: bounds.minX + bounds.width / 2,
                  y: bounds.minY + bounds.height / 2
              }
            : null
    }

    /**
     * Resolves a normalized layer key.
     * @param {unknown} value Layer candidate.
     * @returns {string}
     */
    static layer(value) {
        const raw =
            typeof value === 'object' && value !== null ? value.name : value
        const text = String(raw ?? '').trim()
        const lowered = text.toLowerCase()
        if (['top', 'front', 'f.cu', '1'].includes(lowered)) return 'top'
        if (['bottom', 'back', 'b.cu', '32'].includes(lowered)) return 'bottom'
        return text
    }

    /**
     * Resolves the side from a layer key.
     * @param {string} layer Layer key.
     * @returns {'top' | 'bottom' | ''}
     */
    static side(layer) {
        const text = String(layer || '').toLowerCase()
        if (/\b(bottom|back)\b|\bb[._-]/u.test(text)) return 'bottom'
        if (/\b(top|front)\b|\bf[._-]/u.test(text)) return 'top'
        return ''
    }

    /**
     * Resolves a net name from common fields.
     * @param {object} element Element row.
     * @param {string | null} fallback Fallback net name.
     * @returns {string}
     */
    static netName(element, fallback = '') {
        return String(
            element?.netName ??
                element?.net ??
                element?.net_name ??
                element?.source_net_id ??
                fallback ??
                ''
        ).trim()
    }

    /**
     * Resolves first valid length from candidates.
     * @param {unknown[]} values Candidate values.
     * @returns {number | null}
     */
    static optionalLength(values) {
        for (const value of values) {
            const length = CircuitJsonUnits.optionalLength(value)
            if (length !== null) return length
        }
        return null
    }

    /**
     * Resolves an id for original or derived shape primitives.
     * @param {object} element Element row.
     * @returns {string}
     */
    static derivedId(element) {
        const id = CircuitJsonIndexer.getElementId(element)
        const suffix = String(element.derived_id_suffix || '').trim()
        return id && suffix ? id + ':' + suffix : id
    }

    /**
     * Resolves unique non-empty string values.
     * @param {unknown[]} values Candidate values.
     * @returns {string[]}
     */
    static uniqueStrings(values) {
        return [...new Set(values.map((value) => String(value || '').trim()))]
            .filter(Boolean)
            .sort()
    }
}
