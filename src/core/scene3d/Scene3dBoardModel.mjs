import { CircuitJsonIndexer } from '../CircuitJsonIndexer.mjs'
import { CircuitJsonUnits } from '../CircuitJsonUnits.mjs'

const POINT_LOCATION_LEAF_SIZE = 12
const POINT_LOCATION_MAX_DEPTH = 12
const POINT_LOCATION_MAX_NODES = 4096

/**
 * Keeps aggregate board geometry and per-outline surface heights together.
 */
export class Scene3dBoardModel {
    #board
    #outlines
    #pointCache
    #pointIndex

    /**
     * Creates one board model from all CircuitJSON board rows.
     * @param {object[]} boards Board elements.
     * @param {object[]} cutouts Board cutout elements.
     * @param {number} fallbackThickness Default millimeter thickness.
     * @param {boolean} overrideThickness Whether the option overrides every board.
     */
    constructor(boards, cutouts, fallbackThickness, overrideThickness) {
        this.#outlines = boards.map((board) =>
            Scene3dBoardModel.#outline(
                board,
                fallbackThickness,
                overrideThickness
            )
        )
        const entries = Scene3dBoardModel.#pointEntries(this.#outlines)
        this.#pointCache = new Map()
        this.#pointIndex = Scene3dBoardModel.#pointNode(
            entries,
            entries.length ? Scene3dBoardModel.#entryBounds(entries) : null,
            0,
            { nodes: 0 }
        )
        const bounds = Scene3dBoardModel.#bounds(this.#outlines)
        this.#board = {
            id: this.#outlines[0]?.id || '',
            center: {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2,
                z: 0
            },
            size: {
                x: bounds.maxX - bounds.minX,
                y: bounds.maxY - bounds.minY,
                z: this.#outlines.reduce(
                    (maximum, outline) => Math.max(maximum, outline.thickness),
                    this.#outlines.length ? 0 : fallbackThickness
                )
            },
            material: this.#outlines[0]?.material || 'fr4',
            solderMaskColor: this.#outlines[0]?.solderMaskColor || '',
            silkscreenColor: this.#outlines[0]?.silkscreenColor || '',
            outlines: this.#outlines,
            cutouts: cutouts.map((element) =>
                CircuitJsonIndexer.getElementId(element)
            )
        }
    }

    /**
     * Returns aggregate canonical board geometry.
     * @returns {object} Canonical board record.
     */
    get board() {
        return this.#board
    }

    /**
     * Resolves the containing board surface for one normalized point.
     * @param {'top' | 'bottom'} side Board side.
     * @param {{ x: number, y: number }} point Geometry point.
     * @returns {number} Board surface Z coordinate.
     */
    surfaceZ(side, point) {
        const outline = this.#findOutline(point) || this.#outlines[0]
        const thickness = outline?.thickness || this.#board.size.z
        return side === 'bottom' ? -thickness / 2 : thickness / 2
    }

    /**
     * Queries the spatial hierarchy and preserves first-authored overlap order.
     * @param {{ x: number, y: number }} point Geometry point.
     * @returns {object | null} Containing outline.
     */
    #findOutline(point) {
        const key = `${point.x}\u0000${point.y}`
        if (this.#pointCache.has(key)) return this.#pointCache.get(key)
        const candidates = Scene3dBoardModel.#pointCandidates(
            this.#pointIndex,
            point
        )
        let outline = null
        for (const entry of candidates) {
            if (Scene3dBoardModel.#contains(entry.outline, point)) {
                outline = entry.outline
                break
            }
        }
        this.#pointCache.set(key, outline)
        return outline
    }

    /**
     * Maps one source board to canonical outline geometry.
     * @param {object} board Board element.
     * @param {number} fallbackThickness Default thickness.
     * @param {boolean} overrideThickness Whether the default is an override.
     * @returns {object} Canonical outline.
     */
    static #outline(board, fallbackThickness, overrideThickness) {
        const center = Scene3dBoardModel.#point2(
            board.center || { x: board.x, y: board.y }
        )
        const sourceThickness = CircuitJsonUnits.optionalLength(board.thickness)
        const thickness =
            !overrideThickness &&
            sourceThickness !== null &&
            sourceThickness > 0 &&
            sourceThickness <= 1000
                ? sourceThickness
                : fallbackThickness
        return {
            id: CircuitJsonIndexer.getElementId(board),
            center,
            size: {
                x: CircuitJsonUnits.length(board.width, 0),
                y: CircuitJsonUnits.length(board.height, 0)
            },
            thickness,
            material: String(board.material || 'fr4'),
            solderMaskColor: String(board.solder_mask_color || ''),
            silkscreenColor: String(board.silkscreen_color || ''),
            points: Scene3dBoardModel.#points(board.points || board.outline)
        }
    }

    /**
     * Indexes only the first outline for each identical containment geometry.
     * Later identical outlines can never win first-authored point location.
     * @param {object[]} outlines Canonical authored outlines.
     * @returns {{ outline: object, index: number, bounds: object }[]} Point-location entries.
     */
    static #pointEntries(outlines) {
        const entries = []
        const authoredGeometry = new Set()
        for (let index = 0; index < outlines.length; index += 1) {
            const outline = outlines[index]
            const geometry = Scene3dBoardModel.#geometryKey(outline)
            if (authoredGeometry.has(geometry)) continue
            authoredGeometry.add(geometry)
            entries.push({
                outline,
                index,
                bounds: Scene3dBoardModel.#outlineBounds(outline)
            })
        }
        return entries
    }

    /**
     * Creates a collision-free containment signature from normalized numbers.
     * @param {object} outline Canonical outline.
     * @returns {string} Exact rectangle or authored polygon signature.
     */
    static #geometryKey(outline) {
        if (!outline.points.length) {
            return [
                'rectangle',
                outline.center.x,
                outline.center.y,
                outline.size.x,
                outline.size.y
            ].join('\u0000')
        }
        const values = ['polygon', outline.points.length]
        for (const point of outline.points) {
            values.push(point.x, point.y)
        }
        return values.join('\u0000')
    }

    /**
     * Builds an exact adaptive point-location quadtree over outline geometry.
     * @param {{ outline: object, index: number, bounds: object }[]} entries Authored outline entries.
     * @param {object | null} bounds Cell bounds.
     * @param {number} depth Current tree depth.
     * @param {{ nodes: number }} state Global node budget.
     * @returns {object | null} Point-location node.
     */
    static #pointNode(entries, bounds, depth, state) {
        if (!bounds) return null
        state.nodes += 1
        return {
            bounds,
            entries,
            depth,
            state,
            children: [null, null, null, null]
        }
    }

    /**
     * Returns the exact candidate leaf for one query point.
     * @param {object | null} node Point-location root.
     * @param {{ x: number, y: number }} point Query point.
     * @returns {{ outline: object, index: number, bounds: object }[]} Ordered candidates.
     */
    static #pointCandidates(node, point) {
        if (!node || !Scene3dBoardModel.#boundsContain(node.bounds, point)) {
            return []
        }
        let current = node
        while (
            current.entries.length > POINT_LOCATION_LEAF_SIZE &&
            current.depth < POINT_LOCATION_MAX_DEPTH &&
            current.state.nodes < POINT_LOCATION_MAX_NODES &&
            (current.bounds.minX !== current.bounds.maxX ||
                current.bounds.minY !== current.bounds.maxY)
        ) {
            const midX = (current.bounds.minX + current.bounds.maxX) / 2
            const midY = (current.bounds.minY + current.bounds.maxY) / 2
            const index = (point.x >= midX ? 1 : 0) + (point.y >= midY ? 2 : 0)
            if (!current.children[index]) {
                const cell = Scene3dBoardModel.#childBounds(
                    current.bounds,
                    midX,
                    midY,
                    index
                )
                const relevant = []
                for (const entry of current.entries) {
                    const relation = Scene3dBoardModel.#cellRelation(
                        entry,
                        cell
                    )
                    if (relation === 'disjoint') continue
                    relevant.push(entry)
                    if (relation === 'contains') break
                }
                current.children[index] = Scene3dBoardModel.#pointNode(
                    relevant,
                    cell,
                    current.depth + 1,
                    current.state
                )
            }
            current = current.children[index]
        }
        return current.entries
    }

    /**
     * Returns one lazily requested quadtree child cell.
     * @param {object} bounds Parent bounds.
     * @param {number} midX Parent X midpoint.
     * @param {number} midY Parent Y midpoint.
     * @param {number} index Child quadrant index.
     * @returns {object} Child bounds.
     */
    static #childBounds(bounds, midX, midY, index) {
        const right = index % 2 === 1
        const top = index >= 2
        return {
            minX: right ? midX : bounds.minX,
            minY: top ? midY : bounds.minY,
            maxX: right ? bounds.maxX : midX,
            maxY: top ? bounds.maxY : midY
        }
    }

    /**
     * Classifies one outline relative to a point-location cell.
     * @param {{ outline: object, bounds: object }} entry Outline entry.
     * @param {object} cell Cell bounds.
     * @returns {'disjoint' | 'partial' | 'contains'} Exact conservative relation.
     */
    static #cellRelation(entry, cell) {
        if (!Scene3dBoardModel.#boundsOverlap(entry.bounds, cell)) {
            return 'disjoint'
        }
        if (!entry.outline.points.length) {
            return Scene3dBoardModel.#boundsContainBounds(entry.bounds, cell)
                ? 'contains'
                : 'partial'
        }
        const corners = Scene3dBoardModel.#boundsCorners(cell)
        let insideCount = 0
        for (const corner of corners) {
            if (Scene3dBoardModel.#contains(entry.outline, corner)) {
                insideCount += 1
            }
        }
        const boundary = Scene3dBoardModel.#polygonIntersectsBounds(
            entry.outline.points,
            corners
        )
        if (insideCount === corners.length && !boundary) return 'contains'
        if (insideCount || boundary) return 'partial'
        for (const point of entry.outline.points) {
            if (Scene3dBoardModel.#boundsContain(cell, point)) return 'partial'
        }
        return 'disjoint'
    }

    /**
     * Computes aggregate bounds for indexed outlines.
     * @param {{ bounds: object }[]} entries Indexed outlines.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds.
     */
    static #entryBounds(entries) {
        const result = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
        for (const entry of entries) {
            result.minX = Math.min(result.minX, entry.bounds.minX)
            result.minY = Math.min(result.minY, entry.bounds.minY)
            result.maxX = Math.max(result.maxX, entry.bounds.maxX)
            result.maxY = Math.max(result.maxY, entry.bounds.maxY)
        }
        return result
    }

    /**
     * Tests whether two inclusive bounds overlap.
     * @param {object} left First bounds.
     * @param {object} right Second bounds.
     * @returns {boolean} Whether the bounds overlap.
     */
    static #boundsOverlap(left, right) {
        return !(
            left.maxX < right.minX ||
            left.minX > right.maxX ||
            left.maxY < right.minY ||
            left.minY > right.maxY
        )
    }

    /**
     * Tests whether outer bounds fully contain inner bounds.
     * @param {object} outer Outer bounds.
     * @param {object} inner Inner bounds.
     * @returns {boolean} Whether the inner bounds are contained.
     */
    static #boundsContainBounds(outer, inner) {
        return (
            inner.minX >= outer.minX &&
            inner.maxX <= outer.maxX &&
            inner.minY >= outer.minY &&
            inner.maxY <= outer.maxY
        )
    }

    /**
     * Returns cell corners in closed perimeter order.
     * @param {object} bounds Cell bounds.
     * @returns {{ x: number, y: number }[]} Cell corners.
     */
    static #boundsCorners(bounds) {
        return [
            { x: bounds.minX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.maxY },
            { x: bounds.minX, y: bounds.maxY }
        ]
    }

    /**
     * Tests whether any polygon edge crosses or touches a cell boundary.
     * @param {{ x: number, y: number }[]} points Polygon points.
     * @param {{ x: number, y: number }[]} corners Cell corners.
     * @returns {boolean} Whether boundaries intersect.
     */
    static #polygonIntersectsBounds(points, corners) {
        for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
            const a = points[pointIndex]
            const b = points[(pointIndex + 1) % points.length]
            for (
                let edgeIndex = 0;
                edgeIndex < corners.length;
                edgeIndex += 1
            ) {
                const c = corners[edgeIndex]
                const d = corners[(edgeIndex + 1) % corners.length]
                if (Scene3dBoardModel.#segmentsIntersect(a, b, c, d)) {
                    return true
                }
            }
        }
        return false
    }

    /**
     * Tests two closed line segments for intersection.
     * @param {{ x: number, y: number }} a First segment start.
     * @param {{ x: number, y: number }} b First segment end.
     * @param {{ x: number, y: number }} c Second segment start.
     * @param {{ x: number, y: number }} d Second segment end.
     * @returns {boolean} Whether the segments intersect.
     */
    static #segmentsIntersect(a, b, c, d) {
        const abC = Scene3dBoardModel.#orientation(a, b, c)
        const abD = Scene3dBoardModel.#orientation(a, b, d)
        const cdA = Scene3dBoardModel.#orientation(c, d, a)
        const cdB = Scene3dBoardModel.#orientation(c, d, b)
        if (abC * abD < 0 && cdA * cdB < 0) return true
        return (
            (abC === 0 && Scene3dBoardModel.#onSegment(c, a, b)) ||
            (abD === 0 && Scene3dBoardModel.#onSegment(d, a, b)) ||
            (cdA === 0 && Scene3dBoardModel.#onSegment(a, c, d)) ||
            (cdB === 0 && Scene3dBoardModel.#onSegment(b, c, d))
        )
    }

    /**
     * Returns a tolerance-normalized orientation cross product.
     * @param {{ x: number, y: number }} a Segment start.
     * @param {{ x: number, y: number }} b Segment end.
     * @param {{ x: number, y: number }} point Candidate point.
     * @returns {number} Signed orientation or zero.
     */
    static #orientation(a, b, point) {
        const cross =
            (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
        return Math.abs(cross) <= 1e-9 ? 0 : cross
    }

    /**
     * Tests a point against one axis-aligned bounds record.
     * @param {object} bounds Bounds record.
     * @param {{ x: number, y: number }} point Query point.
     * @returns {boolean} Whether the bounds contain the point.
     */
    static #boundsContain(bounds, point) {
        return (
            point.x >= bounds.minX &&
            point.x <= bounds.maxX &&
            point.y >= bounds.minY &&
            point.y <= bounds.maxY
        )
    }

    /**
     * Computes exact axis-aligned bounds for one canonical outline.
     * @param {object} outline Canonical outline.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds.
     */
    static #outlineBounds(outline) {
        if (!outline.points.length) {
            return {
                minX: outline.center.x - outline.size.x / 2,
                minY: outline.center.y - outline.size.y / 2,
                maxX: outline.center.x + outline.size.x / 2,
                maxY: outline.center.y + outline.size.y / 2
            }
        }
        return Scene3dBoardModel.#entryBounds(
            outline.points.map((point) => ({
                bounds: {
                    minX: point.x,
                    minY: point.y,
                    maxX: point.x,
                    maxY: point.y
                }
            }))
        )
    }

    /**
     * Tests whether a point lies within an outline polygon or rectangle.
     * @param {object} outline Canonical outline.
     * @param {{ x: number, y: number }} point Point.
     * @returns {boolean} Whether the outline contains the point.
     */
    static #contains(outline, point) {
        if (!outline.points.length) {
            return (
                point.x >= outline.center.x - outline.size.x / 2 &&
                point.x <= outline.center.x + outline.size.x / 2 &&
                point.y >= outline.center.y - outline.size.y / 2 &&
                point.y <= outline.center.y + outline.size.y / 2
            )
        }
        let inside = false
        for (
            let current = 0, previous = outline.points.length - 1;
            current < outline.points.length;
            previous = current, current += 1
        ) {
            const a = outline.points[current]
            const b = outline.points[previous]
            if (Scene3dBoardModel.#onSegment(point, a, b)) return true
            const crosses =
                a.y > point.y !== b.y > point.y &&
                point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
            if (crosses) inside = !inside
        }
        return inside
    }

    /**
     * Tests whether a point lies on one polygon edge.
     * @param {{ x: number, y: number }} point Candidate point.
     * @param {{ x: number, y: number }} a Segment start.
     * @param {{ x: number, y: number }} b Segment end.
     * @returns {boolean} Whether the point is on the segment.
     */
    static #onSegment(point, a, b) {
        const cross =
            (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y)
        if (Math.abs(cross) > 1e-9) return false
        return (
            point.x >= Math.min(a.x, b.x) &&
            point.x <= Math.max(a.x, b.x) &&
            point.y >= Math.min(a.y, b.y) &&
            point.y <= Math.max(a.y, b.y)
        )
    }

    /**
     * Computes aggregate bounds from outline rectangles or points.
     * @param {object[]} outlines Canonical outlines.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds.
     */
    static #bounds(outlines) {
        if (!outlines.length) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
        }
        const bounds = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
        for (const outline of outlines) {
            const points = outline.points.length
                ? outline.points
                : [
                      {
                          x: outline.center.x - outline.size.x / 2,
                          y: outline.center.y - outline.size.y / 2
                      },
                      {
                          x: outline.center.x + outline.size.x / 2,
                          y: outline.center.y + outline.size.y / 2
                      }
                  ]
            for (const point of points) {
                bounds.minX = Math.min(bounds.minX, point.x)
                bounds.minY = Math.min(bounds.minY, point.y)
                bounds.maxX = Math.max(bounds.maxX, point.x)
                bounds.maxY = Math.max(bounds.maxY, point.y)
            }
        }
        return bounds
    }

    /**
     * Normalizes a point without accepting non-object input.
     * @param {unknown} point Point candidate.
     * @returns {{ x: number, y: number }} Canonical point.
     */
    static #point2(point) {
        return {
            x: CircuitJsonUnits.length(point?.x, 0),
            y: CircuitJsonUnits.length(point?.y, 0)
        }
    }

    /**
     * Normalizes a board polygon.
     * @param {unknown} points Point candidates.
     * @returns {{ x: number, y: number }[]} Canonical points.
     */
    static #points(points) {
        if (!Array.isArray(points)) return []
        const result = []
        for (const point of points) {
            if (point && typeof point === 'object') {
                result.push(Scene3dBoardModel.#point2(point))
            }
        }
        return result
    }
}

Object.freeze(Scene3dBoardModel.prototype)
Object.freeze(Scene3dBoardModel)
