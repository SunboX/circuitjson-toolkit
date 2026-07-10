import { SafeXmlText } from './SafeXmlText.mjs'

/**
 * Renders shared SVG attributes for CircuitJSON PCB primitives.
 */
export class CircuitJsonPcbPrimitiveAttributeRenderer {
    /**
     * Renders data, paint, and style attributes for one primitive.
     * @param {object} primitive Primitive row.
     * @returns {string}
     */
    static render(primitive) {
        const dataAttributes = [
            ['data-pcb-primitive-id', primitive.id],
            ['data-layer', primitive.layer],
            ['data-net', primitive.netName],
            ['data-component-key', primitive.componentKey],
            ['data-footprint-id', primitive.footprintId],
            ['data-pcb-group-ids', (primitive.groupIds || []).join(' ')],
            ['data-subcircuit-ids', (primitive.subcircuitIds || []).join(' ')],
            ['data-source-net-id', primitive.sourceNetId],
            ['data-net-color', primitive.netColor],
            ['data-knockout', primitive.isKnockout ? 'true' : ''],
            ['data-pcb-component-side', this.#componentSide(primitive)],
            [
                'data-solder-mask-covered',
                primitive.coveredWithSolderMask === undefined ||
                primitive.coveredWithSolderMask === null
                    ? ''
                    : String(Boolean(primitive.coveredWithSolderMask))
            ],
            ['data-primitive-kind', primitive.kind]
        ]
            .filter((entry) => String(entry[1] || '').trim())
            .map(([name, value]) => name + '="' + this.#escapeHtml(value) + '"')
        const style = this.#styleAttribute(primitive)
        const attributes = [
            ...dataAttributes,
            ...this.#paintAttributes(primitive)
        ]
        if (style) attributes.push(style)
        return attributes.join(' ')
    }

    /**
     * Resolves a primitive side from explicit side or layer metadata.
     * @param {object} primitive Primitive row.
     * @returns {string}
     */
    static #componentSide(primitive) {
        const side = String(primitive.side || '')
            .trim()
            .toLowerCase()
        if (side === 'top' || side === 'bottom') return side
        const layer = String(primitive.layer || '')
            .trim()
            .toLowerCase()
        return layer === 'top' || layer === 'bottom' ? layer : ''
    }

    /**
     * Builds an inline style attribute for primitive metadata.
     * @param {object} primitive Primitive row.
     * @returns {string}
     */
    static #styleAttribute(primitive) {
        const netColor = this.#safeColor(primitive.netColor)
        if (!netColor) return ''
        return 'style="--pcb-net-color: ' + netColor + '"'
    }

    /**
     * Builds explicit SVG paint attributes for documentation primitives.
     * @param {object} primitive Primitive row.
     * @returns {string[]}
     */
    static #paintAttributes(primitive) {
        const attributes = []
        const stroke = this.#safeColor(primitive.strokeColor)
        const fill = this.#safeColor(primitive.fillColor)
        const dashArray = this.#safeDashArray(primitive.dashArray)
        if (stroke) attributes.push('stroke="' + stroke + '"')
        if (fill) attributes.push('fill="' + fill + '"')
        if (dashArray) {
            attributes.push(
                'stroke-dasharray="' + this.#escapeHtml(dashArray) + '"'
            )
        }
        return attributes
    }

    /**
     * Returns a color safe for SVG attributes and CSS variables.
     * @param {unknown} value Color candidate.
     * @returns {string}
     */
    static #safeColor(value) {
        const text = String(value || '').trim()
        return /^#[0-9a-f]{3,8}$/iu.test(text) ? text : ''
    }

    /**
     * Returns a numeric dash array safe for SVG attributes.
     * @param {unknown} value Dash array candidate.
     * @returns {string}
     */
    static #safeDashArray(value) {
        const parts = String(value || '')
            .trim()
            .split(/\s+/u)
            .filter(Boolean)
        if (!parts.length) return ''
        return parts.every((part) => Number.isFinite(Number(part)))
            ? parts.join(' ')
            : ''
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
