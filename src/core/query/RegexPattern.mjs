import { ToolkitError } from '../contracts/ToolkitError.mjs'

const ALLOWED_FLAGS = new Set(['i', 'm', 's', 'u'])
const MAX_PATTERN_LENGTH = 4096

/**
 * Compiles bounded regular-expression data without evaluating caller code.
 */
export class RegexPattern {
    /**
     * Compiles one validated pattern and deterministic flag set.
     * @param {unknown} pattern Pattern source.
     * @param {unknown} [flags] JavaScript regular-expression flags.
     * @param {{ caseSensitive?: boolean }} [options] Matching options.
     * @returns {RegExp} Compiled regular expression.
     */
    static compile(pattern, flags = '', options = {}) {
        if (
            typeof pattern !== 'string' ||
            pattern.length > MAX_PATTERN_LENGTH
        ) {
            throw RegexPattern.#error(
                'Query regex patterns must be bounded strings.'
            )
        }
        if (typeof flags !== 'string') {
            throw RegexPattern.#error('Query regex flags must be a string.')
        }

        const normalizedFlags = [...flags]
        if (
            new Set(normalizedFlags).size !== normalizedFlags.length ||
            normalizedFlags.some((flag) => !ALLOWED_FLAGS.has(flag))
        ) {
            throw RegexPattern.#error(
                'Query regex flags must be unique and limited to i, m, s, and u.'
            )
        }
        if (options.caseSensitive !== true && !normalizedFlags.includes('i')) {
            normalizedFlags.push('i')
        }

        try {
            return new RegExp(pattern, normalizedFlags.join(''))
        } catch (error) {
            throw RegexPattern.#error('Query regex pattern is invalid.', error)
        }
    }

    /**
     * Tests one value while resetting state defensively.
     * @param {RegExp} regex Compiled expression.
     * @param {unknown} value Candidate value.
     * @returns {boolean} Whether the value matches.
     */
    static test(regex, value) {
        regex.lastIndex = 0
        return regex.test(String(value ?? ''))
    }

    /**
     * Creates a stable query-pattern validation error.
     * @param {string} message Failure message.
     * @param {unknown} [cause] Native compilation failure.
     * @returns {ToolkitError} Typed query error.
     */
    static #error(message, cause) {
        return new ToolkitError(message, {
            code: 'ERR_QUERY_PATTERN',
            category: 'validation',
            format: 'circuitjson',
            cause
        })
    }
}
