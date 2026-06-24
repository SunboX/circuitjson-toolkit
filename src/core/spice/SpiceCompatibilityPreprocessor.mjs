const PSPICE_NUMBER_TOKEN = String.raw`([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)`
const PSPICE_COMPARISON_OPERATOR = '(?:<=|>=|==|!=|(?<![!<>=])=(?!=)|<|>)'
const PSPICE_COMPARISON_OPERAND = String.raw`(?:V\s*\([^)]*\)|\{[^}\r\n]+\}|${PSPICE_NUMBER_TOKEN}(?:[a-zA-Z]+)?|[A-Za-z_][\w.$]*)`
const PSPICE_COMPARISON_EXPRESSION = String.raw`${PSPICE_COMPARISON_OPERAND}\s*${PSPICE_COMPARISON_OPERATOR}\s*${PSPICE_COMPARISON_OPERAND}`
const PSPICE_COMPARISON_BEFORE_CARET_PATTERN = new RegExp(
    String.raw`${PSPICE_COMPARISON_EXPRESSION}\s*$`,
    'i'
)
const PSPICE_COMPARISON_AFTER_CARET_PATTERN = new RegExp(
    String.raw`^\s*\+?\s*${PSPICE_COMPARISON_EXPRESSION}`,
    'i'
)

/**
 * Rewrites narrow, well-understood SPICE compatibility syntax.
 */
export class SpiceCompatibilityPreprocessor {
    /**
     * Returns a netlist with supported compatibility syntax rewritten.
     * @param {string} spiceString Raw SPICE netlist text.
     * @returns {string}
     */
    static rewrite(spiceString) {
        return SpiceCompatibilityPreprocessor.#rewriteValueBooleanCarets(
            SpiceCompatibilityPreprocessor.#rewriteResistorTemperaturePairs(
                spiceString
            )
        )
    }

    /**
     * Rewrites resistor TC pairs to separate TC1 and TC2 assignments.
     * @param {string} spiceString Raw SPICE netlist text.
     * @returns {string}
     */
    static #rewriteResistorTemperaturePairs(spiceString) {
        return String(spiceString || '')
            .split(/\r?\n/)
            .map((line) => {
                if (!/^\s*r/i.test(line)) return line

                return line.replace(
                    new RegExp(
                        String.raw`\bTC\s*=\s*${PSPICE_NUMBER_TOKEN}\s*,\s*${PSPICE_NUMBER_TOKEN}\b`,
                        'gi'
                    ),
                    'TC1=$1 TC2=$2'
                )
            })
            .join('\n')
    }

    /**
     * Rewrites boolean caret operators inside VALUE expression blocks.
     * @param {string} spiceString Raw SPICE netlist text.
     * @returns {string}
     */
    static #rewriteValueBooleanCarets(spiceString) {
        let result = ''
        let cursor = 0
        const valueStartPattern = /\bVALUE\s*\{/gi

        for (;;) {
            valueStartPattern.lastIndex = cursor
            const match = valueStartPattern.exec(spiceString)
            if (!match) break

            const blockStart = match.index
            const firstBraceIndex = spiceString.indexOf('{', blockStart)
            const blockEnd =
                SpiceCompatibilityPreprocessor.#findBalancedBlockEnd(
                    spiceString,
                    firstBraceIndex
                )

            if (blockEnd === -1) break

            result += spiceString.slice(cursor, blockStart)
            const block = spiceString.slice(blockStart, blockEnd)
            result += block.replace(/\s+\^\s+/g, (operator, offset, full) => {
                if (
                    SpiceCompatibilityPreprocessor.#isValueBooleanCaret(
                        full,
                        offset,
                        operator.length
                    )
                ) {
                    return operator.replace('^', '!=')
                }

                return operator
            })
            cursor = blockEnd
        }

        return result + spiceString.slice(cursor)
    }

    /**
     * Finds the exclusive end offset of a balanced brace block.
     * @param {string} text Source text.
     * @param {number} firstBraceIndex Offset of the opening brace.
     * @returns {number}
     */
    static #findBalancedBlockEnd(text, firstBraceIndex) {
        if (firstBraceIndex < 0) return -1

        let depth = 0
        for (let index = firstBraceIndex; index < text.length; index += 1) {
            const character = text[index]
            if (character === '{') {
                depth += 1
            } else if (character === '}') {
                depth -= 1
                if (depth === 0) return index + 1
            }
        }

        return -1
    }

    /**
     * Returns true when a caret separates two comparison expressions.
     * @param {string} block VALUE block text.
     * @param {number} caretOffset Caret operator offset.
     * @param {number} operatorLength Operator token length.
     * @returns {boolean}
     */
    static #isValueBooleanCaret(block, caretOffset, operatorLength) {
        return (
            PSPICE_COMPARISON_BEFORE_CARET_PATTERN.test(
                block.slice(0, caretOffset)
            ) &&
            PSPICE_COMPARISON_AFTER_CARET_PATTERN.test(
                block.slice(caretOffset + operatorLength)
            )
        )
    }
}
