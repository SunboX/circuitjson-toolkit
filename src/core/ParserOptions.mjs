import { ToolkitAsset } from './contracts/ToolkitAsset.mjs'
import { AttachedValueLimits } from './AttachedValueLimits.mjs'

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
        const inputFields = ParserOptions.#plainDescriptors(
            input,
            'CircuitJSON parser input must be an object.'
        )
        const optionFields = ParserOptions.#plainDescriptors(
            options,
            'CircuitJSON parser options must be an object.'
        )
        const data = ParserOptions.#dataValue(inputFields.data)
        const inputAssets = ParserOptions.#dataValue(inputFields.assets)
        if (!ParserOptions.#isData(data)) {
            throw new TypeError(
                'CircuitJSON parser data must be a string, ArrayBuffer, or Uint8Array.'
            )
        }
        if (inputAssets !== undefined && !Array.isArray(inputAssets)) {
            throw new TypeError('CircuitJSON parser assets must be an array.')
        }
        if (inputAssets !== undefined) AttachedValueLimits.add(inputAssets)

        const decodeAssetsValue = ParserOptions.#dataValue(
            optionFields.decodeAssets
        )
        const decodeAssets = String(
            decodeAssetsValue === undefined ? 'metadata' : decodeAssetsValue
        )
        if (!ASSET_MODES.has(decodeAssets)) {
            throw new TypeError(
                `Unsupported CircuitJSON asset decode mode: ${decodeAssets}.`
            )
        }
        const extensions = ParserOptions.#extensions(
            ParserOptions.#dataValue(optionFields.extensions)
        )
        const reports = ParserOptions.#stringList(
            ParserOptions.#dataValue(optionFields.reports),
            'report'
        )
        const retainSourceValue = ParserOptions.#dataValue(
            optionFields.retainSource
        )
        const retainSource = String(
            retainSourceValue === undefined ? 'none' : retainSourceValue
        )
        if (!RETAIN_SOURCE_MODES.has(retainSource)) {
            throw new TypeError(
                `Unsupported CircuitJSON source retention mode: ${retainSource}.`
            )
        }
        const workerValue = ParserOptions.#dataValue(optionFields.worker)
        const worker = workerValue === undefined ? 'auto' : workerValue
        if (!WORKER_MODES.has(worker)) {
            throw new TypeError(
                'CircuitJSON worker must be auto, true, or false.'
            )
        }
        if (
            ParserOptions.#dataValue(optionFields.onProgress) !== undefined &&
            typeof ParserOptions.#dataValue(optionFields.onProgress) !==
                'function'
        ) {
            throw new TypeError('CircuitJSON onProgress must be a function.')
        }

        return {
            input: {
                fileName: ParserOptions.fileName(input),
                data,
                assets: inputAssets || []
            },
            sourceReference: input,
            options: {
                preserveRaw:
                    ParserOptions.#dataValue(optionFields.preserveRaw) === true,
                decodeAssets,
                extensions,
                reports,
                retainSource,
                worker,
                transferInput:
                    ParserOptions.#dataValue(optionFields.transferInput) ===
                    true,
                signal: ParserOptions.#dataValue(optionFields.signal),
                onProgress: ParserOptions.#dataValue(optionFields.onProgress)
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
        return ToolkitAsset.prepareAll(assets, { mode })
    }

    /**
     * Performs bounded CircuitJSON array detection without full JSON parsing.
     * @param {unknown} input Parser input candidate.
     * @returns {boolean} Whether the input has a CircuitJSON array prefix.
     */
    static supports(input) {
        try {
            const descriptors = ParserOptions.#plainDescriptors(
                input,
                'CircuitJSON parser input must be an object.'
            )
            const data = ParserOptions.#dataValue(descriptors.data)
            if (!ParserOptions.#isData(data)) return false
            return ParserOptions.#prefix(data).trimStart().startsWith('[')
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
        try {
            const descriptors = ParserOptions.#plainDescriptors(
                input,
                'CircuitJSON parser input must be an object.'
            )
            const fileName = ParserOptions.#dataValue(descriptors.fileName)
            if (
                fileName !== undefined &&
                !['string', 'number', 'boolean', 'bigint'].includes(
                    typeof fileName
                )
            ) {
                return ''
            }
            return String(fileName || '')
                .replaceAll('\\', '/')
                .replace(/^\.\//u, '')
        } catch {
            return ''
        }
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
        const descriptors = ParserOptions.#arrayDescriptors(value, label)
        const items = []
        for (let index = 0; index < descriptors.length.value; index += 1) {
            const item = descriptors[String(index)].value
            if (typeof item !== 'string' || !item.trim()) {
                throw new TypeError(
                    `CircuitJSON ${label} ids must be non-empty strings.`
                )
            }
            items.push(item.trim())
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

    /**
     * Returns own data descriptors for a plain request record.
     * @param {unknown} value Record candidate.
     * @param {string} message Failure message.
     * @returns {Record<string, PropertyDescriptor>} Data descriptors.
     */
    static #plainDescriptors(value, message) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError(message)
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw new TypeError(message)
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(message)
        }
        for (const descriptor of Object.values(descriptors)) {
            if (!Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    'CircuitJSON parser fields must be data properties.'
                )
            }
        }
        return descriptors
    }

    /**
     * Returns exact dense-array descriptors without caller iteration.
     * @param {unknown} value Array candidate.
     * @param {string} label Item label.
     * @returns {Record<string, PropertyDescriptor>} Array descriptors.
     */
    static #arrayDescriptors(value, label) {
        if (!Array.isArray(value)) {
            throw new TypeError(`CircuitJSON ${label}s must be an array.`)
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw new TypeError(`CircuitJSON ${label}s must be a dense array.`)
        }
        const length = ParserOptions.#dataValue(descriptors.length)
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            Reflect.ownKeys(descriptors).length !== length + 1
        ) {
            throw new TypeError(`CircuitJSON ${label}s must be a dense array.`)
        }
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                throw new TypeError(
                    `CircuitJSON ${label}s must contain data properties.`
                )
            }
        }
        return descriptors
    }

    /**
     * Reads one data descriptor value.
     * @param {PropertyDescriptor | undefined} descriptor Descriptor.
     * @returns {unknown} Data value.
     */
    static #dataValue(descriptor) {
        return descriptor && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined
    }
}
