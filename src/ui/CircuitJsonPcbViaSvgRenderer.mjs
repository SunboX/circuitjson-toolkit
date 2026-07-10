import { SafeXmlText } from './SafeXmlText.mjs'

/**
 * Renders via-like drilled primitives as SVG shapes.
 */
export class CircuitJsonPcbViaSvgRenderer {
    /**
     * Renders one via-like primitive.
     * @param {object} primitive Via-like primitive.
     * @param {string} attributes Data attributes for the primitive group.
     * @returns {string}
     */
    static render(primitive, attributes = '') {
        const groupAttributes = attributes ? ' ' + attributes : ''
        return (
            '<g class="pcb-via-group"' +
            groupAttributes +
            '>' +
            CircuitJsonPcbViaSvgRenderer.#shape(
                primitive,
                'pcb-via',
                primitive.shape || 'circle',
                primitive.width || primitive.diameter,
                primitive.height || primitive.diameter
            ) +
            CircuitJsonPcbViaSvgRenderer.#shape(
                primitive,
                'pcb-via__hole',
                primitive.holeShape || 'circle',
                primitive.holeWidth || primitive.holeDiameter,
                primitive.holeHeight || primitive.holeDiameter
            ) +
            '</g>'
        )
    }

    /**
     * Renders one centered SVG shape.
     * @param {object} primitive Via-like primitive.
     * @param {string} baseClass Base CSS class.
     * @param {string} shape Shape name.
     * @param {number} width Shape width.
     * @param {number} height Shape height.
     * @returns {string}
     */
    static #shape(primitive, baseClass, shape, width, height) {
        const normalizedShape = String(shape || 'circle').toLowerCase()
        const className =
            baseClass +
            ' ' +
            baseClass.replace('__', '-') +
            '--' +
            CircuitJsonPcbViaSvgRenderer.#escapeHtml(normalizedShape)

        if (normalizedShape === 'circle') {
            return (
                '<circle class="' +
                className +
                '" cx="' +
                CircuitJsonPcbViaSvgRenderer.#formatNumber(primitive.x) +
                '" cy="' +
                CircuitJsonPcbViaSvgRenderer.#formatNumber(primitive.y) +
                '" r="' +
                CircuitJsonPcbViaSvgRenderer.#formatNumber(width / 2) +
                '"></circle>'
            )
        }

        if (
            normalizedShape === 'polygon' &&
            Array.isArray(primitive.points) &&
            primitive.points.length >= 3
        ) {
            return (
                '<polygon class="' +
                className +
                '" points="' +
                CircuitJsonPcbViaSvgRenderer.#escapeHtml(
                    CircuitJsonPcbViaSvgRenderer.#pointsAttribute(
                        primitive.points
                    )
                ) +
                '"></polygon>'
            )
        }

        return (
            '<rect class="' +
            className +
            '" x="' +
            CircuitJsonPcbViaSvgRenderer.#formatNumber(
                primitive.x - width / 2
            ) +
            '" y="' +
            CircuitJsonPcbViaSvgRenderer.#formatNumber(
                primitive.y - height / 2
            ) +
            '" width="' +
            CircuitJsonPcbViaSvgRenderer.#formatNumber(width) +
            '" height="' +
            CircuitJsonPcbViaSvgRenderer.#formatNumber(height) +
            '" rx="' +
            CircuitJsonPcbViaSvgRenderer.#formatNumber(
                normalizedShape === 'pill' ? Math.min(width, height) / 2 : 0
            ) +
            '"' +
            CircuitJsonPcbViaSvgRenderer.#rotationAttribute(primitive) +
            '></rect>'
        )
    }

    /**
     * Builds a rotation transform attribute.
     * @param {object} primitive Via-like primitive.
     * @returns {string}
     */
    static #rotationAttribute(primitive) {
        const rotation = Number(primitive.rotation || 0)
        if (!Number.isFinite(rotation) || rotation === 0) return ''
        return (
            ' transform="rotate(' +
            CircuitJsonPcbViaSvgRenderer.#formatNumber(rotation) +
            ' ' +
            CircuitJsonPcbViaSvgRenderer.#formatNumber(primitive.x) +
            ' ' +
            CircuitJsonPcbViaSvgRenderer.#formatNumber(primitive.y) +
            ')"'
        )
    }

    /**
     * Builds a polygon points attribute.
     * @param {{ x: number, y: number }[]} points Point rows.
     * @returns {string}
     */
    static #pointsAttribute(points) {
        return points
            .map(
                (point) =>
                    CircuitJsonPcbViaSvgRenderer.#formatNumber(point.x) +
                    ',' +
                    CircuitJsonPcbViaSvgRenderer.#formatNumber(point.y)
            )
            .join(' ')
    }

    /**
     * Formats a number for SVG output.
     * @param {number} value Numeric value.
     * @returns {string}
     */
    static #formatNumber(value) {
        const number = Number(value)
        if (!Number.isFinite(number)) return '0'
        return String(Math.round(number * 1_000_000) / 1_000_000)
    }

    /**
     * Escapes text for HTML attributes.
     * @param {unknown} value Raw value.
     * @returns {string}
     */
    static #escapeHtml(value) {
        return SafeXmlText.escape(value)
    }
}
