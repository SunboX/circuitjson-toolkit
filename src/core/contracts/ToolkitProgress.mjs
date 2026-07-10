import { ToolkitError } from './ToolkitError.mjs'

const STAGES = ['detect', 'decode', 'project', 'validate', 'complete']

/**
 * Creates ordered shared progress records.
 */
export class ToolkitProgress {
    /**
     * Normalizes one progress update and validates it against the previous row.
     * @param {Record<string, any>} fields Progress fields.
     * @param {Record<string, any> | null} [previous] Previous progress row.
     * @returns {Record<string, any>} Clone-safe progress row.
     */
    static create(fields = {}, previous = null) {
        const stage = String(fields.stage || '')
        const stageIndex = STAGES.indexOf(stage)
        if (stageIndex < 0) {
            throw ToolkitProgress.#error(
                'ERR_PROGRESS_STAGE',
                `Unknown progress stage: ${stage || '(empty)'}`
            )
        }
        if (previous?.stage === 'complete') {
            throw ToolkitProgress.#error(
                'ERR_PROGRESS_TERMINAL',
                'Progress cannot continue after complete.'
            )
        }
        const previousIndex = previous ? STAGES.indexOf(previous.stage) : -1
        if (previous && (previousIndex < 0 || stageIndex < previousIndex)) {
            throw ToolkitProgress.#error(
                'ERR_PROGRESS_ORDER',
                `Progress cannot move from ${previous.stage} to ${stage}.`
            )
        }

        const completed = ToolkitProgress.#count(fields.completed, null)
        const total = ToolkitProgress.#count(fields.total, null)
        if (completed !== null && total !== null && completed > total) {
            throw ToolkitProgress.#error(
                'ERR_PROGRESS_COUNT',
                'Progress completed count exceeds total.'
            )
        }

        const result = { stage }
        if (fields.detail != null && String(fields.detail)) {
            result.detail = String(fields.detail)
        }
        if (fields.completed !== undefined) result.completed = completed
        if (fields.total !== undefined) result.total = total
        if (fields.message != null && String(fields.message)) {
            result.message = String(fields.message)
        }
        return result
    }

    /**
     * Normalizes a nullable non-negative count.
     * @param {unknown} value Count candidate.
     * @param {number | null} fallback Fallback value.
     * @returns {number | null} Normalized count.
     */
    static #count(value, fallback) {
        if (value == null) return fallback
        const count = Number(value)
        if (!Number.isFinite(count) || count < 0) {
            throw ToolkitProgress.#error(
                'ERR_PROGRESS_COUNT',
                'Progress counts must be finite and non-negative.'
            )
        }
        return count
    }

    /**
     * Creates a progress validation error.
     * @param {string} code Error code.
     * @param {string} message Error message.
     * @returns {ToolkitError} Typed error.
     */
    static #error(code, message) {
        return new ToolkitError(message, {
            code,
            category: 'progress'
        })
    }
}
