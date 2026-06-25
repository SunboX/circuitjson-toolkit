import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'

/**
 * Normalizes drawing style fields from PCB documentation rows.
 */
export class CircuitJsonPcbDrawingStyle {
    /**
     * Resolves drawing style metadata from one element row.
     * @param {object} element Element row.
     * @returns {{ strokeColor?: string, fillColor?: string, dashArray?: string }}
     */
    static fromElement(element) {
        return CircuitJsonPcbDrawingStyle.#clean({
            strokeColor: CircuitJsonPcbDrawingStyle.#safeColor(
                element.stroke_color || element.strokeColor || element.color
            ),
            fillColor: CircuitJsonPcbDrawingStyle.#safeColor(
                element.fill_color || element.fillColor
            ),
            dashArray: CircuitJsonPcbDrawingStyle.#dashArray(element)
        })
    }

    /**
     * Builds a normalized dash array.
     * @param {object} element Element row.
     * @returns {string}
     */
    static #dashArray(element) {
        const explicit =
            element.stroke_dasharray || element.dash_array || element.dashArray
        if (Array.isArray(explicit)) {
            return CircuitJsonPcbDrawingStyle.#dashValues(explicit)
        }
        if (String(explicit || '').trim()) {
            return CircuitJsonPcbDrawingStyle.#dashValues(
                String(explicit).trim().split(/\s+/u)
            )
        }
        if (element.is_dashed !== true && element.dashed !== true) return ''

        const dashLength = CircuitJsonUnits.optionalLength(
            element.dash_length ?? element.dashLength
        )
        const dashGap = CircuitJsonUnits.optionalLength(
            element.dash_gap ?? element.dashGap
        )
        return CircuitJsonPcbDrawingStyle.#dashValues([
            dashLength ?? 0.4,
            dashGap ?? dashLength ?? 0.4
        ])
    }

    /**
     * Normalizes dash values.
     * @param {unknown[]} values Dash values.
     * @returns {string}
     */
    static #dashValues(values) {
        const numbers = values.map(Number).filter((value) => value > 0)
        return numbers.length
            ? numbers.map((value) => String(Number(value.toFixed(6)))).join(' ')
            : ''
    }

    /**
     * Returns a safe hex color.
     * @param {unknown} value Color candidate.
     * @returns {string}
     */
    static #safeColor(value) {
        const text = String(value || '').trim()
        return /^#[0-9a-f]{3,8}$/iu.test(text) ? text : ''
    }

    /**
     * Removes empty style fields.
     * @param {object} value Style metadata.
     * @returns {object}
     */
    static #clean(value) {
        return Object.fromEntries(
            Object.entries(value).filter(([_key, entry]) =>
                String(entry || '').trim()
            )
        )
    }
}
