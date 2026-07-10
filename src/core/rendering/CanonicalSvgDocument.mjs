import { SafeXmlText } from '../../ui/SafeXmlText.mjs'

/**
 * Applies safe common metadata and style controls to generated SVG documents.
 */
export class CanonicalSvgDocument {
    /**
     * Decorates one deterministic generated SVG root.
     * @param {string} svg Generated SVG markup.
     * @param {Record<string, any>} [controls] Normalized SVG controls.
     * @returns {string} Decorated SVG markup.
     */
    static decorate(svg, controls = {}) {
        if (!CanonicalSvgDocument.#hasControls(controls)) return svg
        const rootEnd = svg.indexOf('>')
        if (!svg.startsWith('<svg') || rootEnd < 0) return svg
        let root = svg.slice(0, rootEnd)
        if (controls.className) {
            root = root.replace(
                /\sclass="([^"]*)"/u,
                (_match, className) =>
                    ' class="' +
                    CanonicalSvgDocument.#attribute(
                        className + ' ' + controls.className
                    ) +
                    '"'
            )
        }
        const attributes = []
        if (controls.id) attributes.push(['id', controls.id])
        for (const [key, value] of Object.entries(controls.attributes || {})) {
            attributes.push([key, value])
        }
        const style = Object.entries(controls.style || {})
            .map(([key, value]) => `${key}:${value}`)
            .join(';')
        if (style) attributes.push(['style', style])
        const renderedAttributes = attributes
            .map(
                ([key, value]) =>
                    ' ' +
                    key +
                    '="' +
                    CanonicalSvgDocument.#attribute(value) +
                    '"'
            )
            .join('')
        const accessible =
            (typeof controls.title === 'string'
                ? '<title>' +
                  CanonicalSvgDocument.#text(controls.title) +
                  '</title>'
                : '') +
            (typeof controls.description === 'string'
                ? '<desc>' +
                  CanonicalSvgDocument.#text(controls.description) +
                  '</desc>'
                : '')
        return (
            root.slice(0, 4) +
            renderedAttributes +
            root.slice(4) +
            '>' +
            accessible +
            svg.slice(rootEnd + 1)
        )
    }

    /**
     * Returns true when any normalized control changes output.
     * @param {Record<string, any>} controls Normalized controls.
     * @returns {boolean} Whether decoration is required.
     */
    static #hasControls(controls) {
        return Boolean(
            controls?.id ||
            controls?.className ||
            typeof controls?.title === 'string' ||
            typeof controls?.description === 'string' ||
            Object.keys(controls?.attributes || {}).length ||
            Object.keys(controls?.style || {}).length
        )
    }

    /**
     * Escapes one SVG attribute value.
     * @param {unknown} value Raw value.
     * @returns {string} Escaped value.
     */
    static #attribute(value) {
        return SafeXmlText.escape(value)
    }

    /**
     * Escapes one SVG text value.
     * @param {unknown} value Raw value.
     * @returns {string} Escaped value.
     */
    static #text(value) {
        return SafeXmlText.escapeText(value)
    }
}
