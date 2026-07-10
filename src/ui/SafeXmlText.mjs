/**
 * Sanitizes and escapes untrusted scalar data for deterministic XML output.
 */
export class SafeXmlText {
    /**
     * Escapes XML text and attribute data, including quotation marks.
     * @param {unknown} value Scalar value.
     * @returns {string} Well-formed escaped XML.
     */
    static escape(value) {
        return SafeXmlText.#escape(value, true)
    }

    /**
     * Escapes XML character data while leaving quotation marks literal.
     * @param {unknown} value Scalar value.
     * @returns {string} Well-formed escaped XML text.
     */
    static escapeText(value) {
        return SafeXmlText.#escape(value, false)
    }

    /**
     * Escapes allowed characters and replaces invalid XML scalars.
     * @param {unknown} value Scalar value.
     * @param {boolean} quote Whether quotation marks require escaping.
     * @returns {string} Safe XML data.
     */
    static #escape(value, quote) {
        let result = ''
        for (const candidate of String(value ?? '')) {
            const character = SafeXmlText.#isAllowed(candidate)
                ? candidate
                : '\ufffd'
            if (character === '&') result += '&amp;'
            else if (character === '<') result += '&lt;'
            else if (character === '>') result += '&gt;'
            else if (quote && character === '"') result += '&quot;'
            else result += character
        }
        return result
    }

    /**
     * Returns whether one Unicode scalar belongs to the XML 1.0 Char set.
     * @param {string} character One iterated character.
     * @returns {boolean} Whether XML permits the character.
     */
    static #isAllowed(character) {
        const codePoint = character.codePointAt(0)
        return (
            codePoint === 0x09 ||
            codePoint === 0x0a ||
            codePoint === 0x0d ||
            (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
            (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
            (codePoint >= 0x10000 && codePoint <= 0x10ffff)
        )
    }
}
