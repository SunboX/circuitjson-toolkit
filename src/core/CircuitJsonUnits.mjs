const MILS_PER_MM = 39.37007874015748

/**
 * Unit helpers for CircuitJSON's millimeter-based PCB dimensions.
 */
export class CircuitJsonUnits {
    /**
     * Converts millimeters to mils.
     * @param {unknown} value Millimeter value.
     * @param {number} [fallback] Fallback millimeter value.
     * @returns {number}
     */
    static mmToMil(value, fallback = 0) {
        return CircuitJsonUnits.#round(
            CircuitJsonUnits.#number(value, fallback) * MILS_PER_MM
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
     * Converts a value to a finite number.
     * @param {unknown} value Candidate number.
     * @param {number} fallback Fallback number.
     * @returns {number}
     */
    static #number(value, fallback) {
        const numeric = Number(value)
        return Number.isFinite(numeric) ? numeric : fallback
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
