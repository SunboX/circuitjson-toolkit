const LENGTH_FACTORS_TO_MM = new Map([
    ['mm', 1],
    ['millimeter', 1],
    ['millimeters', 1],
    ['cm', 10],
    ['centimeter', 10],
    ['centimeters', 10],
    ['m', 1000],
    ['meter', 1000],
    ['meters', 1000],
    ['in', 25.4],
    ['inch', 25.4],
    ['inches', 25.4],
    ['mil', 0.0254],
    ['mils', 0.0254],
    ['um', 0.001],
    ['micrometer', 0.001],
    ['micrometers', 0.001]
])
const ANGLE_FACTORS_TO_DEG = new Map([
    ['deg', 1],
    ['degree', 1],
    ['degrees', 1],
    ['rad', 180 / Math.PI],
    ['radian', 180 / Math.PI],
    ['radians', 180 / Math.PI]
])

/**
 * Rounds unit conversions to stable precision.
 * @param {number} value Numeric value.
 * @returns {number} Rounded value.
 */
export function round(value) {
    return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Parses one numeric value with an optional unit suffix.
 * @param {unknown} value Value candidate.
 * @param {Map<string, number>} unitFactors Unit factor lookup.
 * @returns {number | null} Parsed value or null.
 */
function parseUnitValue(value, unitFactors) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? round(value) : null
    }

    const text = String(value ?? '').trim()
    if (!text) return null
    const match = text.match(
        /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]+)?$/iu
    )
    if (!match) return null

    const number = Number(match[1])
    if (!Number.isFinite(number)) return null
    const unit = String(match[2] || '').toLowerCase()
    const factor = unit ? unitFactors.get(unit) : 1
    return Number.isFinite(factor) ? round(number * factor) : null
}

/**
 * Parses an optional millimeter length.
 * @param {unknown} value Length candidate.
 * @returns {number | null} Parsed length or null.
 */
export function optionalLength(value) {
    return parseUnitValue(value, LENGTH_FACTORS_TO_MM)
}

/**
 * Parses an optional degree angle.
 * @param {unknown} value Angle candidate.
 * @returns {number | null} Parsed angle or null.
 */
export function optionalAngle(value) {
    return parseUnitValue(value, ANGLE_FACTORS_TO_DEG)
}

/**
 * Parses an optional point.
 * @param {{ x?: unknown, y?: unknown } | null | undefined} point Point.
 * @returns {{ x: number, y: number } | null} Parsed point or null.
 */
export function optionalPoint(point) {
    const x = optionalLength(point?.x)
    const y = optionalLength(point?.y)
    return x === null || y === null ? null : { x, y }
}

/**
 * Parses an optional size.
 * @param {{ width?: unknown, height?: unknown } | null | undefined} size Size.
 * @returns {{ width: number, height: number } | null} Parsed size or null.
 */
export function optionalSize(size) {
    const width = optionalLength(size?.width)
    const height = optionalLength(size?.height)
    return width === null || height === null ? null : { width, height }
}
