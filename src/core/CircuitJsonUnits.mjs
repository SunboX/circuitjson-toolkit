import * as UnitParsers from './CircuitJsonUnitParsers.mjs'

const MILS_PER_MM = 39.37007874015748

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
        return UnitParsers.optionalLength(value) ?? UnitParsers.round(fallback)
    }

    /**
     * Converts a length value to millimeters, or null when invalid.
     * @param {unknown} value Length candidate.
     * @returns {number | null}
     */
    static optionalLength(value) {
        return UnitParsers.optionalLength(value)
    }

    /**
     * Converts an angle value to degrees.
     * @param {unknown} value Angle candidate.
     * @param {number} [fallback] Fallback degree value.
     * @returns {number}
     */
    static angle(value, fallback = 0) {
        return UnitParsers.optionalAngle(value) ?? UnitParsers.round(fallback)
    }

    /**
     * Converts an angle value to degrees, or null when invalid.
     * @param {unknown} value Angle candidate.
     * @returns {number | null}
     */
    static optionalAngle(value) {
        return UnitParsers.optionalAngle(value)
    }

    /**
     * Converts a point to normalized millimeter coordinates.
     * @param {{ x?: unknown, y?: unknown } | null | undefined} point Point.
     * @returns {{ x: number, y: number }}
     */
    static point(point) {
        return {
            x: UnitParsers.optionalLength(point?.x) ?? 0,
            y: UnitParsers.optionalLength(point?.y) ?? 0
        }
    }

    /**
     * Converts a point to normalized millimeter coordinates when valid.
     * @param {{ x?: unknown, y?: unknown } | null | undefined} point Point.
     * @returns {{ x: number, y: number } | null}
     */
    static optionalPoint(point) {
        return UnitParsers.optionalPoint(point)
    }

    /**
     * Converts a size to normalized millimeter dimensions.
     * @param {{ width?: unknown, height?: unknown } | null | undefined} size Size.
     * @returns {{ width: number, height: number } | null}
     */
    static optionalSize(size) {
        return UnitParsers.optionalSize(size)
    }

    /**
     * Converts millimeters to mils.
     * @param {unknown} value Millimeter value.
     * @param {number} [fallback] Fallback millimeter value.
     * @returns {number}
     */
    static mmToMil(value, fallback = 0) {
        return UnitParsers.round(
            (UnitParsers.optionalLength(value) ?? UnitParsers.round(fallback)) *
                MILS_PER_MM
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
}
