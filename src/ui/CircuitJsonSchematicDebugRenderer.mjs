import { CircuitJsonUnits } from '../core/CircuitJsonUnits.mjs'
import { SafeXmlText } from './SafeXmlText.mjs'

/**
 * Renders every standard CircuitJSON schematic debug-object variant.
 */
export class CircuitJsonSchematicDebugRenderer {
    /**
     * Renders one debug object or an empty string for invalid geometry.
     * @param {object} element Debug element.
     * @returns {string} Debug SVG group.
     */
    static render(element) {
        if (
            element.shape === undefined ||
            element.legacy_shape_omitted === true
        ) {
            return CircuitJsonSchematicDebugRenderer.#legacyRect(element)
        }
        const shape = String(element.shape || 'rect')
        const geometry = CircuitJsonSchematicDebugRenderer.#geometry(
            element,
            shape
        )
        if (!geometry) return ''
        const label = String(element.label ?? element.message ?? '').trim()
        return (
            '<g class="schematic-debug-object" data-schematic-debug-object-id="' +
            CircuitJsonSchematicDebugRenderer.#escape(
                element.schematic_debug_object_id || ''
            ) +
            '"><title>' +
            CircuitJsonSchematicDebugRenderer.#escape(label) +
            '</title>' +
            geometry.markup +
            '<text x="' +
            CircuitJsonSchematicDebugRenderer.#number(geometry.label.x) +
            '" y="' +
            CircuitJsonSchematicDebugRenderer.#number(geometry.label.y) +
            '" text-anchor="middle" dominant-baseline="central">' +
            CircuitJsonSchematicDebugRenderer.#escape(label) +
            '</text></g>'
        )
    }

    /**
     * Preserves the original unqualified rectangle markup byte-for-byte.
     * @param {object} element Legacy debug element.
     * @returns {string} Legacy SVG group.
     */
    static #legacyRect(element) {
        const center = CircuitJsonUnits.optionalPoint(element.center)
        const size = CircuitJsonUnits.optionalSize(element.size || element)
        if (!center || !size) return ''
        const message = String(element.message || '').trim()
        return (
            '<g class="schematic-debug-object" data-schematic-debug-object-id="' +
            CircuitJsonSchematicDebugRenderer.#escape(
                element.schematic_debug_object_id || ''
            ) +
            '"><title>' +
            CircuitJsonSchematicDebugRenderer.#escape(message) +
            '</title><rect x="' +
            CircuitJsonSchematicDebugRenderer.#number(
                center.x - size.width / 2
            ) +
            '" y="' +
            CircuitJsonSchematicDebugRenderer.#number(
                center.y - size.height / 2
            ) +
            '" width="' +
            CircuitJsonSchematicDebugRenderer.#number(size.width) +
            '" height="' +
            CircuitJsonSchematicDebugRenderer.#number(size.height) +
            '"></rect><text x="' +
            CircuitJsonSchematicDebugRenderer.#number(center.x) +
            '" y="' +
            CircuitJsonSchematicDebugRenderer.#number(center.y) +
            '" text-anchor="middle" dominant-baseline="central">' +
            CircuitJsonSchematicDebugRenderer.#escape(message) +
            '</text></g>'
        )
    }

    /**
     * Builds variant geometry and its label anchor.
     * @param {object} element Debug element.
     * @param {string} shape Standard shape discriminant.
     * @returns {{ markup: string, label: { x: number, y: number } } | null} Geometry.
     */
    static #geometry(element, shape) {
        if (shape === 'line') {
            const start = CircuitJsonUnits.optionalPoint(element.start)
            const end = CircuitJsonUnits.optionalPoint(element.end)
            if (!start || !end) return null
            return {
                markup:
                    '<line class="schematic-debug-object__line" x1="' +
                    CircuitJsonSchematicDebugRenderer.#number(start.x) +
                    '" y1="' +
                    CircuitJsonSchematicDebugRenderer.#number(start.y) +
                    '" x2="' +
                    CircuitJsonSchematicDebugRenderer.#number(end.x) +
                    '" y2="' +
                    CircuitJsonSchematicDebugRenderer.#number(end.y) +
                    '"></line>',
                label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
            }
        }
        const center = CircuitJsonUnits.optionalPoint(element.center)
        if (!center) return null
        if (shape === 'point') {
            return {
                markup:
                    '<circle class="schematic-debug-object__point" cx="' +
                    CircuitJsonSchematicDebugRenderer.#number(center.x) +
                    '" cy="' +
                    CircuitJsonSchematicDebugRenderer.#number(center.y) +
                    '" r="0.25"></circle>',
                label: center
            }
        }
        const size = CircuitJsonUnits.optionalSize(element.size || element)
        if (!size) return null
        return {
            markup:
                '<rect class="schematic-debug-object__rect" x="' +
                CircuitJsonSchematicDebugRenderer.#number(
                    center.x - size.width / 2
                ) +
                '" y="' +
                CircuitJsonSchematicDebugRenderer.#number(
                    center.y - size.height / 2
                ) +
                '" width="' +
                CircuitJsonSchematicDebugRenderer.#number(size.width) +
                '" height="' +
                CircuitJsonSchematicDebugRenderer.#number(size.height) +
                '"></rect>',
            label: center
        }
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

    /**
     * Escapes XML text and attribute data.
     * @param {unknown} value Text candidate.
     * @returns {string} Escaped text.
     */
    static #escape(value) {
        return SafeXmlText.escape(value)
    }
}
