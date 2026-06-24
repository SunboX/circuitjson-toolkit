const MILS_PER_MM = 39.37007874015748
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
 * Unit helpers for CircuitJSON's millimeter-based PCB dimensions.
 */
export class CircuitJsonUnits {
    /**
     * Converts a length value to millimeters.
     * @param {unknown} value Length candidate.
     * @param {number} [fallback] Fallback millimeter value.
     * @returns {number}
     */
    static length(value, fallback = 0) {
        return (
            CircuitJsonUnits.optionalLength(value) ??
            CircuitJsonUnits.#round(fallback)
        )
    }

    /**
     * Converts a length value to millimeters, or null when invalid.
     * @param {unknown} value Length candidate.
     * @returns {number | null}
     */
    static optionalLength(value) {
        return CircuitJsonUnits.#parseUnitValue(value, LENGTH_FACTORS_TO_MM)
    }

    /**
     * Converts an angle value to degrees.
     * @param {unknown} value Angle candidate.
     * @param {number} [fallback] Fallback degree value.
     * @returns {number}
     */
    static angle(value, fallback = 0) {
        return (
            CircuitJsonUnits.optionalAngle(value) ??
            CircuitJsonUnits.#round(fallback)
        )
    }

    /**
     * Converts an angle value to degrees, or null when invalid.
     * @param {unknown} value Angle candidate.
     * @returns {number | null}
     */
    static optionalAngle(value) {
        return CircuitJsonUnits.#parseUnitValue(value, ANGLE_FACTORS_TO_DEG)
    }

    /**
     * Converts a point to normalized millimeter coordinates.
     * @param {{ x?: unknown, y?: unknown } | null | undefined} point Point.
     * @returns {{ x: number, y: number }}
     */
    static point(point) {
        return {
            x: CircuitJsonUnits.length(point?.x, 0),
            y: CircuitJsonUnits.length(point?.y, 0)
        }
    }

    /**
     * Converts a point to normalized millimeter coordinates when valid.
     * @param {{ x?: unknown, y?: unknown } | null | undefined} point Point.
     * @returns {{ x: number, y: number } | null}
     */
    static optionalPoint(point) {
        const x = CircuitJsonUnits.optionalLength(point?.x)
        const y = CircuitJsonUnits.optionalLength(point?.y)
        return x === null || y === null ? null : { x, y }
    }

    /**
     * Converts a size to normalized millimeter dimensions.
     * @param {{ width?: unknown, height?: unknown } | null | undefined} size Size.
     * @returns {{ width: number, height: number } | null}
     */
    static optionalSize(size) {
        const width = CircuitJsonUnits.optionalLength(size?.width)
        const height = CircuitJsonUnits.optionalLength(size?.height)
        return width === null || height === null ? null : { width, height }
    }

    /**
     * Converts millimeters to mils.
     * @param {unknown} value Millimeter value.
     * @param {number} [fallback] Fallback millimeter value.
     * @returns {number}
     */
    static mmToMil(value, fallback = 0) {
        return CircuitJsonUnits.#round(
            CircuitJsonUnits.length(value, fallback) * MILS_PER_MM
        )
    }

    /**
     * Converts a CircuitJSON point from millimeters to mils.
     * @param {{ x?: unknown, y?: unknown } | null | undefined} point Point.
     * @returns {{ x: number, y: number }}
     */
    static pointMmToMil(point) {
        return {
            x: CircuitJsonUnits.mmToMil(point?.x, 0),
            y: CircuitJsonUnits.mmToMil(point?.y, 0)
        }
    }

    /**
     * Parses one numeric value with an optional unit suffix.
     * @param {unknown} value Value candidate.
     * @param {Map<string, number>} unitFactors Unit factor lookup.
     * @returns {number | null}
     */
    static #parseUnitValue(value, unitFactors) {
        if (typeof value === 'number') {
            return Number.isFinite(value)
                ? CircuitJsonUnits.#round(value)
                : null
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
        if (!Number.isFinite(factor)) return null

        return CircuitJsonUnits.#round(number * factor)
    }

    /**
     * Rounds render-unit conversions to stable precision.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #round(value) {
        return Math.round(value * 1_000_000) / 1_000_000
    }
}
