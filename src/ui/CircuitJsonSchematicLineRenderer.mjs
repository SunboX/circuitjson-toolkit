import { CircuitJsonUnits } from '../core/CircuitJsonUnits.mjs'
import { CircuitJsonSchematicSvgPrimitiveAttributes } from './CircuitJsonSchematicSvgPrimitiveAttributes.mjs'

/**
 * Renders standard trace edges while preserving legacy line aliases.
 */
export class CircuitJsonSchematicLineRenderer {
    /**
     * Renders all usable standard edges or one legacy fallback segment.
     * @param {object} element Line or trace element.
     * @returns {string[]} SVG line elements.
     */
    static render(element) {
        if (
            element.type === 'schematic_trace' &&
            Array.isArray(element.edges)
        ) {
            const edges = element.edges
                .map((edge) =>
                    CircuitJsonSchematicLineRenderer.#segment(
                        element,
                        edge?.from,
                        edge?.to
                    )
                )
                .filter(Boolean)
            if (edges.length) return edges
        }
        const fallback = CircuitJsonSchematicLineRenderer.#segment(element)
        return fallback ? [fallback] : []
    }

    /**
     * Renders one line segment from explicit endpoints or legacy aliases.
     * @param {object} element Source element.
     * @param {unknown} [startValue] Standard edge start.
     * @param {unknown} [endValue] Standard edge end.
     * @returns {string} SVG line or empty string.
     */
    static #segment(element, startValue, endValue) {
        const start = CircuitJsonUnits.optionalPoint(
            startValue !== undefined
                ? startValue
                : {
                      x: element.x1 ?? element.start?.x,
                      y: element.y1 ?? element.start?.y
                  }
        )
        const end = CircuitJsonUnits.optionalPoint(
            endValue !== undefined
                ? endValue
                : {
                      x: element.x2 ?? element.end?.x,
                      y: element.y2 ?? element.end?.y
                  }
        )
        if (!start || !end) return ''
        return (
            '<line class="schematic-wire" x1="' +
            CircuitJsonSchematicLineRenderer.#number(start.x) +
            '" y1="' +
            CircuitJsonSchematicLineRenderer.#number(start.y) +
            '" x2="' +
            CircuitJsonSchematicLineRenderer.#number(end.x) +
            '" y2="' +
            CircuitJsonSchematicLineRenderer.#number(end.y) +
            '"' +
            CircuitJsonSchematicSvgPrimitiveAttributes.attributes(element, {
                fill: false
            }) +
            '></line>'
        )
    }

    /**
     * Formats one finite SVG number.
     * @param {unknown} value Number candidate.
     * @returns {string} SVG number.
     */
    static #number(value) {
        const number = Number(value)
        return Number.isFinite(number)
            ? Number(number.toFixed(6)).toString()
            : '0'
    }
}
