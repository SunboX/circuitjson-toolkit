const ASSET_MODES = new Set(['none', 'metadata', 'full'])
const EXTENSION_MODES = new Set(['none', 'metadata', 'canonical', 'full'])
const RETAIN_SOURCE_MODES = new Set(['none', 'reference'])
const WORKER_MODES = new Set(['auto', true, false])

/**
 * Normalizes the common standalone parser input and option contract.
 */
export class ParserOptions {
    /**
     * Normalizes one parser request without decoding its CircuitJSON payload.
     * @param {unknown} input Parser input candidate.
     * @param {unknown} [options] Common parser options candidate.
     * @returns {{ input: { fileName: string, data: string | ArrayBuffer | Uint8Array, assets: object[] }, sourceReference: object, options: { preserveRaw: boolean, decodeAssets: string, extensions: string | string[], reports: string[], retainSource: string, worker: 'auto' | boolean, transferInput: boolean, signal: any, onProgress: Function | undefined } }} Normalized request.
     */
    static normalize(input, options = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('CircuitJSON parser input must be an object.')
        }
        if (!ParserOptions.#isData(input.data)) {
            throw new TypeError(
                'CircuitJSON parser data must be a string, ArrayBuffer, or Uint8Array.'
            )
        }
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('CircuitJSON parser options must be an object.')
        }
        if (input.assets !== undefined && !Array.isArray(input.assets)) {
            throw new TypeError('CircuitJSON parser assets must be an array.')
        }

        const decodeAssets = String(options.decodeAssets || 'metadata')
        if (!ASSET_MODES.has(decodeAssets)) {
            throw new TypeError(
                `Unsupported CircuitJSON asset decode mode: ${decodeAssets}.`
            )
        }
        const extensions = ParserOptions.#extensions(options.extensions)
        const reports = ParserOptions.#stringList(options.reports, 'report')
        const retainSource = String(options.retainSource || 'none')
        if (!RETAIN_SOURCE_MODES.has(retainSource)) {
            throw new TypeError(
                `Unsupported CircuitJSON source retention mode: ${retainSource}.`
            )
        }
        const worker = options.worker === undefined ? 'auto' : options.worker
        if (!WORKER_MODES.has(worker)) {
            throw new TypeError(
                'CircuitJSON worker must be auto, true, or false.'
            )
        }
        if (
            options.onProgress !== undefined &&
            typeof options.onProgress !== 'function'
        ) {
            throw new TypeError('CircuitJSON onProgress must be a function.')
        }

        return {
            input: {
                fileName: ParserOptions.fileName(input),
                data: input.data,
                assets: input.assets || []
            },
            sourceReference: input,
            options: {
                preserveRaw: options.preserveRaw === true,
                decodeAssets,
                extensions,
                reports,
                retainSource,
                worker,
                transferInput: options.transferInput === true,
                signal: options.signal,
                onProgress: options.onProgress
            }
        }
    }

    /**
     * Decodes supported parser data into JSON text.
     * @param {string | ArrayBuffer | Uint8Array} data Parser payload.
     * @returns {string} Decoded text.
     */
    static text(data) {
        if (typeof data === 'string') return data
        if (data instanceof ArrayBuffer) {
            return new TextDecoder().decode(new Uint8Array(data))
        }
        if (data instanceof Uint8Array) return new TextDecoder().decode(data)
        throw new TypeError(
            'CircuitJSON parser data must be a string, ArrayBuffer, or Uint8Array.'
        )
    }

    /**
     * Selects supplied assets for one canonicalization by DocumentResult.
     * @param {object[]} assets Supplied asset records.
     * @param {string} mode Asset decode mode.
     * @returns {object[]} Selected canonical assets.
     */
    static assets(assets, mode) {
        if (mode === 'none') return []
        if (mode === 'full') return assets
        return assets.map((asset) => ({
            ...asset,
            byteLength: ParserOptions.#assetByteLength(asset),
            data: null
        }))
    }

    /**
     * Performs bounded CircuitJSON array detection without full JSON parsing.
     * @param {unknown} input Parser input candidate.
     * @returns {boolean} Whether the input has a CircuitJSON array prefix.
     */
    static supports(input) {
        try {
            if (!input || typeof input !== 'object' || Array.isArray(input)) {
                return false
            }
            if (!ParserOptions.#isData(input.data)) return false
            return ParserOptions.#prefix(input.data).trimStart().startsWith('[')
        } catch {
            return false
        }
    }

    /**
     * Normalizes a source file name for errors and result identity.
     * @param {unknown} input Parser input candidate.
     * @returns {string} Normalized file name.
     */
    static fileName(input) {
        return String(input?.fileName || '')
            .replaceAll('\\', '/')
            .replace(/^\.\//u, '')
    }

    /**
     * Normalizes the extensions mode or selected feature ids.
     * @param {unknown} value Extensions option candidate.
     * @returns {string | string[]} Normalized extensions option.
     */
    static #extensions(value) {
        if (value === undefined) return 'canonical'
        if (Array.isArray(value)) {
            return ParserOptions.#stringList(value, 'extension feature')
        }
        const mode = String(value)
        if (!EXTENSION_MODES.has(mode)) {
            throw new TypeError(
                `Unsupported CircuitJSON extensions mode: ${mode}.`
            )
        }
        return mode
    }

    /**
     * Normalizes one option list into unique non-empty strings.
     * @param {unknown} value List candidate.
     * @param {string} label Item label.
     * @returns {string[]} Normalized list.
     */
    static #stringList(value, label) {
        if (value === undefined) return []
        if (!Array.isArray(value)) {
            throw new TypeError(`CircuitJSON ${label}s must be an array.`)
        }
        const items = value.map((item) => String(item).trim())
        if (items.some((item) => !item)) {
            throw new TypeError(`CircuitJSON ${label} ids must not be empty.`)
        }
        return [...new Set(items)]
    }

    /**
     * Returns true for the canonical parser payload types.
     * @param {unknown} data Payload candidate.
     * @returns {boolean} Whether the payload type is supported.
     */
    static #isData(data) {
        return (
            typeof data === 'string' ||
            data instanceof ArrayBuffer ||
            data instanceof Uint8Array
        )
    }

    /**
     * Measures supplied asset data without copying its payload.
     * @param {unknown} asset Asset candidate.
     * @returns {number} Byte length.
     */
    static #assetByteLength(asset) {
        const data = asset?.data
        if (data instanceof ArrayBuffer) return data.byteLength
        if (ArrayBuffer.isView(data)) return data.byteLength
        if (typeof data === 'string') {
            return new TextEncoder().encode(data).byteLength
        }
        const declared = Number(asset?.byteLength)
        return Number.isFinite(declared) && declared >= 0 ? declared : 0
    }

    /**
     * Decodes only a bounded prefix for format detection.
     * @param {string | ArrayBuffer | Uint8Array} data Parser payload.
     * @returns {string} Bounded text prefix.
     */
    static #prefix(data) {
        const limit = 512
        if (typeof data === 'string') return data.slice(0, limit)
        const bytes =
            data instanceof Uint8Array
                ? data.subarray(0, limit)
                : new Uint8Array(data, 0, Math.min(data.byteLength, limit))
        return new TextDecoder().decode(bytes)
    }
}
