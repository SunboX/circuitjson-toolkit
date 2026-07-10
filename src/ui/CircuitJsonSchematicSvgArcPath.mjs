/**
 * Builds SVG path data for schematic arcs.
 */
export class CircuitJsonSchematicSvgArcPath {
    /**
     * Builds arc path data from start, mid, and end points.
     * @param {{ x: number, y: number } | null} start Start point.
     * @param {{ x: number, y: number } | null} mid Midpoint on the arc.
     * @param {{ x: number, y: number } | null} end End point.
     * @returns {string}
     */
    static fromThreePoints(start, mid, end) {
        if (!start || !mid || !end) return ''
        const geometry = CircuitJsonSchematicSvgArcPath.#geometry(
            start,
            mid,
            end
        )
        if (!geometry) {
            return (
                'M ' +
                CircuitJsonSchematicSvgArcPath.#formatPoint(start) +
                ' L ' +
                CircuitJsonSchematicSvgArcPath.#formatPoint(end)
            )
        }

        return (
            'M ' +
            CircuitJsonSchematicSvgArcPath.#formatPoint(start) +
            ' A ' +
            CircuitJsonSchematicSvgArcPath.#formatNumber(
                geometry.circle.radius
            ) +
            ' ' +
            CircuitJsonSchematicSvgArcPath.#formatNumber(
                geometry.circle.radius
            ) +
            ' 0 ' +
            geometry.largeArc +
            ' ' +
            geometry.sweep +
            ' ' +
            CircuitJsonSchematicSvgArcPath.#formatPoint(end)
        )
    }

    /**
     * Resolves the exact axis-aligned bounds of the rendered three-point arc.
     * @param {{ x: number, y: number } | null} start Start point.
     * @param {{ x: number, y: number } | null} mid Midpoint on the arc.
     * @param {{ x: number, y: number } | null} end End point.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null} Arc bounds.
     */
    static boundsFromThreePoints(start, mid, end) {
        if (!start || !mid || !end) return null
        const geometry = CircuitJsonSchematicSvgArcPath.#geometry(
            start,
            mid,
            end
        )
        if (!geometry) {
            return CircuitJsonSchematicSvgArcPath.#bounds([start, end])
        }
        const points = [start, end]
        for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
            if (
                !CircuitJsonSchematicSvgArcPath.#containsAngle(geometry, angle)
            ) {
                continue
            }
            points.push({
                x: geometry.circle.x + Math.cos(angle) * geometry.circle.radius,
                y: geometry.circle.y + Math.sin(angle) * geometry.circle.radius
            })
        }
        return CircuitJsonSchematicSvgArcPath.#bounds(points)
    }

    /**
     * Resolves the shared circle and directed sweep through three points.
     * @param {{ x: number, y: number }} start Start point.
     * @param {{ x: number, y: number }} mid Midpoint on the arc.
     * @param {{ x: number, y: number }} end End point.
     * @returns {{ circle: { x: number, y: number, radius: number }, startAngle: number, endAngle: number, sweep: 0 | 1, span: number, largeArc: 0 | 1 } | null} Arc geometry.
     */
    static #geometry(start, mid, end) {
        const circle = CircuitJsonSchematicSvgArcPath.#circle(start, mid, end)
        if (!circle) return null
        const startAngle = CircuitJsonSchematicSvgArcPath.#angle(circle, start)
        const midAngle = CircuitJsonSchematicSvgArcPath.#angle(circle, mid)
        const endAngle = CircuitJsonSchematicSvgArcPath.#angle(circle, end)
        const clockwiseSpan = CircuitJsonSchematicSvgArcPath.#positiveDelta(
            startAngle,
            endAngle
        )
        const clockwiseMid = CircuitJsonSchematicSvgArcPath.#positiveDelta(
            startAngle,
            midAngle
        )
        const sweep = clockwiseMid <= clockwiseSpan + 0.000001 ? 1 : 0
        const span =
            sweep === 1
                ? clockwiseSpan
                : CircuitJsonSchematicSvgArcPath.#positiveDelta(
                      endAngle,
                      startAngle
                  )
        return {
            circle,
            startAngle,
            endAngle,
            sweep,
            span,
            largeArc: span > Math.PI ? 1 : 0
        }
    }

    /**
     * Returns whether one cardinal angle lies on the directed arc sweep.
     * @param {{ startAngle: number, sweep: 0 | 1, span: number }} geometry Arc geometry.
     * @param {number} angle Candidate angle.
     * @returns {boolean} Whether the angle is visible.
     */
    static #containsAngle(geometry, angle) {
        const delta =
            geometry.sweep === 1
                ? CircuitJsonSchematicSvgArcPath.#positiveDelta(
                      geometry.startAngle,
                      angle
                  )
                : CircuitJsonSchematicSvgArcPath.#positiveDelta(
                      angle,
                      geometry.startAngle
                  )
        return delta <= geometry.span + 0.000001
    }

    /**
     * Builds finite bounds around a non-empty point list.
     * @param {{ x: number, y: number }[]} points Points to include.
     * @returns {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds.
     */
    static #bounds(points) {
        const bounds = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
        for (const point of points) {
            bounds.minX = Math.min(bounds.minX, point.x)
            bounds.minY = Math.min(bounds.minY, point.y)
            bounds.maxX = Math.max(bounds.maxX, point.x)
            bounds.maxY = Math.max(bounds.maxY, point.y)
        }
        return bounds
    }

    /**
     * Resolves the circle through three points.
     * @param {{ x: number, y: number }} start Start point.
     * @param {{ x: number, y: number }} mid Midpoint.
     * @param {{ x: number, y: number }} end End point.
     * @returns {{ x: number, y: number, radius: number } | null}
     */
    static #circle(start, mid, end) {
        const denominator =
            2 *
            (start.x * (mid.y - end.y) +
                mid.x * (end.y - start.y) +
                end.x * (start.y - mid.y))
        if (Math.abs(denominator) < 0.000001) return null

        const startLength = start.x * start.x + start.y * start.y
        const midLength = mid.x * mid.x + mid.y * mid.y
        const endLength = end.x * end.x + end.y * end.y
        const x =
            (startLength * (mid.y - end.y) +
                midLength * (end.y - start.y) +
                endLength * (start.y - mid.y)) /
            denominator
        const y =
            (startLength * (end.x - mid.x) +
                midLength * (start.x - end.x) +
                endLength * (mid.x - start.x)) /
            denominator
        const radius = Math.hypot(start.x - x, start.y - y)

        return Number.isFinite(radius) ? { x, y, radius } : null
    }

    /**
     * Resolves the angle from a circle center to a point.
     * @param {{ x: number, y: number }} center Circle center.
     * @param {{ x: number, y: number }} point Point on circle.
     * @returns {number}
     */
    static #angle(center, point) {
        return Math.atan2(point.y - center.y, point.x - center.x)
    }

    /**
     * Resolves the positive angular delta from start to end.
     * @param {number} start Start angle.
     * @param {number} end End angle.
     * @returns {number}
     */
    static #positiveDelta(start, end) {
        const full = Math.PI * 2
        return (((end - start) % full) + full) % full
    }

    /**
     * Formats one point for SVG path data.
     * @param {{ x: number, y: number }} point Point.
     * @returns {string}
     */
    static #formatPoint(point) {
        return (
            CircuitJsonSchematicSvgArcPath.#formatNumber(point.x) +
            ' ' +
            CircuitJsonSchematicSvgArcPath.#formatNumber(point.y)
        )
    }

    /**
     * Formats one SVG number.
     * @param {number} value Number value.
     * @returns {string}
     */
    static #formatNumber(value) {
        const number = Number(value)
        const integer = Math.round(number)
        if (Math.abs(number - integer) < 0.000001) return String(integer)
        return Number(number.toFixed(6)).toString()
    }
}
