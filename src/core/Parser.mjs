import { DocumentResult } from './contracts/DocumentResult.mjs'
import { ToolkitError } from './contracts/ToolkitError.mjs'
import { ToolkitProgress } from './contracts/ToolkitProgress.mjs'
import { ParserOptions } from './ParserOptions.mjs'

const PROGRESS_MESSAGES = {
    detect: 'Detecting CircuitJSON input.',
    decode: 'Decoding CircuitJSON.',
    validate: 'Validating CircuitJSON.',
    complete: 'CircuitJSON parsing complete.'
}

/**
 * Parses standalone CircuitJSON inputs into canonical document envelopes.
 */
export class Parser {
    /**
     * Parses one CircuitJSON input synchronously.
     * @param {{ fileName: string, data: string | ArrayBuffer | Uint8Array, assets?: object[] }} input Parser input.
     * @param {Record<string, any>} [options] Common parser options.
     * @returns {Record<string, any>} Canonical document result.
     */
    static parse(input, options = {}) {
        try {
            const normalized = ParserOptions.normalize(input, options)
            if (normalized.options.worker === true) {
                throw Parser.#workerSyncError(normalized.input.fileName)
            }
            return Parser.#parseNormalized(normalized)
        } catch (error) {
            throw Parser.#parseError(error, input)
        }
    }

    /**
     * Parses one CircuitJSON input without throwing public parse failures.
     * @param {{ fileName: string, data: string | ArrayBuffer | Uint8Array, assets?: object[] }} input Parser input.
     * @param {Record<string, any>} [options] Common parser options.
     * @returns {{ ok: true, value: Record<string, any> } | { ok: false, error: ToolkitError, diagnostics: object[] }} Discriminated parse result.
     */
    static tryParse(input, options = {}) {
        try {
            return { ok: true, value: Parser.parse(input, options) }
        } catch (error) {
            return {
                ok: false,
                error: Parser.#parseError(error, input),
                diagnostics: []
            }
        }
    }

    /**
     * Parses one CircuitJSON input through the currently available direct path.
     * @param {{ fileName: string, data: string | ArrayBuffer | Uint8Array, assets?: object[] }} input Parser input.
     * @param {Record<string, any>} [options] Common parser options.
     * @returns {Promise<Record<string, any>>} Canonical document result.
     */
    static async parseAsync(input, options = {}) {
        let normalized
        try {
            normalized = ParserOptions.normalize(input, options)
            if (normalized.options.signal?.aborted) {
                throw Parser.#cancelledError(normalized.input.fileName)
            }
            if (normalized.options.worker === true) {
                throw Parser.#workerUnavailableError(normalized.input.fileName)
            }
            Parser.#assertReports(
                normalized.options.reports,
                normalized.input.fileName
            )
        } catch (error) {
            throw Parser.#parseError(error, input)
        }

        let progress = Parser.#progress(normalized, 'detect')
        progress = Parser.#progress(normalized, 'decode', progress)
        let model
        try {
            model = Parser.#decode(normalized)
        } catch (error) {
            throw Parser.#parseError(error, input)
        }

        progress = Parser.#progress(normalized, 'validate', progress)
        let document
        try {
            document = Parser.#document(normalized, model)
        } catch (error) {
            throw Parser.#parseError(error, input)
        }
        Parser.#progress(normalized, 'complete', progress)
        return document
    }

    /**
     * Performs bounded detection for canonical CircuitJSON array inputs.
     * @param {unknown} input Parser input candidate.
     * @returns {boolean} Whether the input is supported.
     */
    static supports(input) {
        return ParserOptions.supports(input)
    }

    /**
     * Decodes and validates one normalized request exactly once.
     * @param {{ input: { fileName: string, data: string | ArrayBuffer | Uint8Array, assets: object[] }, options: Record<string, any> }} normalized Normalized request.
     * @returns {Record<string, any>} Canonical document result.
     */
    static #parseNormalized(normalized) {
        Parser.#assertReports(
            normalized.options.reports,
            normalized.input.fileName
        )
        const model = Parser.#decode(normalized)
        return Parser.#document(normalized, model)
    }

    /**
     * Decodes one normalized payload and enforces the model-array boundary.
     * @param {{ input: { data: string | ArrayBuffer | Uint8Array } }} normalized Normalized request.
     * @returns {object[]} Decoded CircuitJSON model.
     */
    static #decode(normalized) {
        const model = JSON.parse(ParserOptions.text(normalized.input.data))
        if (!Array.isArray(model)) {
            throw new TypeError('Expected a CircuitJSON element array.')
        }
        return model
    }

    /**
     * Validates one model and creates its canonical document envelope.
     * @param {{ input: { fileName: string, assets: object[] }, sourceReference: object, options: { decodeAssets: string, retainSource: string } }} normalized Normalized request.
     * @param {object[]} model Decoded CircuitJSON model.
     * @returns {Record<string, any>} Canonical document result.
     */
    static #document(normalized, model) {
        const runtime =
            normalized.options.retainSource === 'reference'
                ? { sourceReference: normalized.sourceReference }
                : {}
        return DocumentResult.createValidated(
            {
                fileName: normalized.input.fileName,
                fileType: 'circuitjson',
                format: 'circuitjson',
                model,
                extensions: {},
                assets: ParserOptions.assets(
                    normalized.input.assets,
                    normalized.options.decodeAssets
                )
            },
            runtime
        )
    }

    /**
     * Emits one ordered direct-parser progress row when requested.
     * @param {{ options: { onProgress?: Function } }} normalized Normalized request.
     * @param {'detect' | 'decode' | 'validate' | 'complete'} stage Common progress stage.
     * @param {Record<string, any> | null} [previous] Previous progress row.
     * @returns {Record<string, any> | null} Emitted row or the prior state.
     */
    static #progress(normalized, stage, previous = null) {
        if (!normalized.options.onProgress) return previous
        const row = ToolkitProgress.create(
            { stage, message: PROGRESS_MESSAGES[stage] },
            previous
        )
        normalized.options.onProgress(row)
        return row
    }

    /**
     * Rejects report ids because CircuitJSON exposes no eager parser reports.
     * @param {string[]} reports Requested report ids.
     * @param {string} source Source file name.
     * @returns {void}
     */
    static #assertReports(reports, source) {
        if (!reports.length) return
        throw new ToolkitError(
            `CircuitJSON parser report is unavailable: ${reports[0]}.`,
            {
                code: 'ERR_CAPABILITY_UNAVAILABLE',
                category: 'unsupported',
                format: 'circuitjson',
                source,
                details: { reports }
            }
        )
    }

    /**
     * Normalizes public parse failures while preserving typed option failures.
     * @param {unknown} error Failure candidate.
     * @param {unknown} input Original parser input.
     * @returns {ToolkitError} Typed parser failure.
     */
    static #parseError(error, input) {
        return ToolkitError.from(error, {
            code: 'ERR_CIRCUITJSON_PARSE',
            category: 'parse',
            format: 'circuitjson',
            source: ParserOptions.fileName(input)
        })
    }

    /**
     * Creates the synchronous worker-mode error.
     * @param {string} source Source file name.
     * @returns {ToolkitError} Typed unsupported error.
     */
    static #workerSyncError(source) {
        return new ToolkitError(
            'Synchronous CircuitJSON parsing cannot use a worker.',
            {
                code: 'ERR_WORKER_SYNC_UNAVAILABLE',
                category: 'unsupported',
                format: 'circuitjson',
                source
            }
        )
    }

    /**
     * Creates the temporary Task 11 worker-unavailable error.
     * @param {string} source Source file name.
     * @returns {ToolkitError} Typed unsupported error.
     */
    static #workerUnavailableError(source) {
        return new ToolkitError(
            'CircuitJSON parser workers are not available in this build.',
            {
                code: 'ERR_CAPABILITY_UNAVAILABLE',
                category: 'unsupported',
                format: 'circuitjson',
                source,
                details: { capability: 'parser.worker' }
            }
        )
    }

    /**
     * Creates a pre-start cancellation error.
     * @param {string} source Source file name.
     * @returns {ToolkitError} Typed cancellation error.
     */
    static #cancelledError(source) {
        return new ToolkitError('CircuitJSON parsing was cancelled.', {
            code: 'ERR_CANCELLED',
            category: 'cancelled',
            format: 'circuitjson',
            source
        })
    }
}
