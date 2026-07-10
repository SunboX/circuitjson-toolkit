import { SafeXmlText } from './SafeXmlText.mjs'

/**
 * Builds SVG drawing attributes for schematic primitive rows.
 */
export class CircuitJsonSchematicSvgPrimitiveAttributes {
    /**
     * Builds optional SVG attributes from common drawing style fields.
     * @param {object} element CircuitJSON element row.
     * @param {{ fill?: boolean }} [options] Attribute options.
     * @returns {string}
     */
    static attributes(element, options = {}) {
        const attributes = []
        const strokeWidth = CircuitJsonSchematicSvgPrimitiveAttributes.#number(
            element?.stroke_width ?? element?.strokeWidth
        )
        const strokeColor = CircuitJsonSchematicSvgPrimitiveAttributes.#text(
            element?.stroke_color ?? element?.strokeColor ?? element?.color
        )
        const fillColor = CircuitJsonSchematicSvgPrimitiveAttributes.#text(
            element?.fill_color ?? element?.fillColor
        )
        const dashArray =
            CircuitJsonSchematicSvgPrimitiveAttributes.#dashArray(element)

        if (strokeWidth !== null) {
            attributes.push(
                'stroke-width="' +
                    CircuitJsonSchematicSvgPrimitiveAttributes.#formatNumber(
                        strokeWidth
                    ) +
                    '"'
            )
        }
        const safeStroke = SafeSvgPaint.color(strokeColor)
        const safeFill = SafeSvgPaint.color(fillColor)
        if (safeStroke) {
            attributes.push(
                'stroke="' +
                    CircuitJsonSchematicSvgPrimitiveAttributes.#escapeHtml(
                        safeStroke
                    ) +
                    '"'
            )
        }
        if (options.fill !== false && safeFill) {
            attributes.push(
                'fill="' +
                    CircuitJsonSchematicSvgPrimitiveAttributes.#escapeHtml(
                        safeFill
                    ) +
                    '"'
            )
        }
        if (dashArray) {
            attributes.push(
                'stroke-dasharray="' +
                    CircuitJsonSchematicSvgPrimitiveAttributes.#escapeHtml(
                        dashArray
                    ) +
                    '"'
            )
        }

        return attributes.length ? ' ' + attributes.join(' ') : ''
    }

    /**
     * Resolves a finite number.
     * @param {unknown} value Number candidate.
     * @returns {number | null}
     */
    static #number(value) {
        const number = Number(value)
        return Number.isFinite(number) ? number : null
    }

    /**
     * Resolves non-empty text.
     * @param {unknown} value Text candidate.
     * @returns {string}
     */
    static #text(value) {
        return String(value ?? '').trim()
    }

    /**
     * Resolves a stroke dash array.
     * @param {object} element CircuitJSON element row.
     * @returns {string}
     */
    static #dashArray(element) {
        const value =
            element?.stroke_dasharray ??
            element?.strokeDasharray ??
            element?.dash_pattern ??
            element?.dashPattern
        const values = Array.isArray(value) ? value : [value]
        const parts = values
            .map((entry) =>
                CircuitJsonSchematicSvgPrimitiveAttributes.#number(entry)
            )
            .filter((entry) => entry !== null)
            .map((entry) =>
                CircuitJsonSchematicSvgPrimitiveAttributes.#formatNumber(entry)
            )

        if (parts.length) return parts.join(' ')
        return element?.is_dashed ? '0.4 0.25' : ''
    }

    /**
     * Formats one SVG number.
     * @param {number} value Number value.
     * @returns {string}
     */
    static #formatNumber(value) {
        return Number(Number(value).toFixed(6)).toString()
    }

    /**
     * Escapes markup text.
     * @param {unknown} value Raw value.
     * @returns {string}
     */
    static #escapeHtml(value) {
        return SafeXmlText.escape(value)
    }
}
import { SafeSvgPaint } from './SafeSvgPaint.mjs'
