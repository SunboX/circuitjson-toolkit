const NUMERIC_COLOR =
    /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(\s*[-+.%0-9,\s/]+\)$/iu

/**
 * Normalizes literal SVG paint without admitting resource URL contexts.
 */
export class SafeSvgPaint {
    /**
     * Returns a bounded literal CSS/SVG color or an empty string.
     * @param {unknown} value Paint candidate.
     * @returns {string} Safe literal paint.
     */
    static color(value) {
        const text = String(value ?? '').trim()
        if (!text || text.length > 128) return ''
        if (
            /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(
                text
            )
        ) {
            return text
        }
        if (/^[a-z]{3,24}$/iu.test(text)) return text
        return NUMERIC_COLOR.test(text) ? text : ''
    }
}
