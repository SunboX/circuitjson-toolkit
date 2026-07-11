import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'

/**
 * Normalizes SMT pad shape metadata for PCB primitive builders.
 */
export class CircuitJsonPcbPadPrimitiveModel {
    /**
     * Resolves a normalized SMT pad shape value.
     * @param {object} element Pad element.
     * @returns {string}
     */
    static shape(element) {
        return String(element.legacy_shape || element.shape || 'rect')
            .trim()
            .toLowerCase()
    }

    /**
     * Resolves a pad corner radius from explicit or shape-derived metadata.
     * @param {object} element Pad element.
     * @param {string} shape Normalized pad shape.
     * @param {number} width Pad width.
     * @param {number} height Pad height.
     * @returns {number}
     */
    static radius(element, shape, width, height) {
        const explicitRadius =
            CircuitJsonPcbPadPrimitiveModel.explicitRadius(element)
        return (
            explicitRadius ??
            CircuitJsonPcbPadPrimitiveModel.#defaultRadius(shape, width, height)
        )
    }

    /**
     * Resolves an explicit pad corner radius.
     * @param {object} element Pad element.
     * @returns {number | null}
     */
    static explicitRadius(element) {
        return CircuitJsonUnits.optionalLength(
            element.radius ??
                element.corner_radius ??
                element.cornerRadius ??
                element.border_radius ??
                element.borderRadius
        )
    }

    /**
     * Resolves a default corner radius for pad shape variants.
     * @param {string} shape Normalized pad shape.
     * @param {number} width Pad width.
     * @param {number} height Pad height.
     * @returns {number}
     */
    static #defaultRadius(shape, width, height) {
        if (
            shape === 'circle' ||
            shape === 'pill' ||
            shape === 'rotated_pill'
        ) {
            return Math.min(width, height) / 2
        }
        if (shape === 'rounded_rect') {
            return Math.min(width, height) * 0.18
        }
        return 0
    }
}
