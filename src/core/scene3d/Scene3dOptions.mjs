import { CircuitJsonUnits } from '../CircuitJsonUnits.mjs'
import { ToolkitError } from '../contracts/ToolkitError.mjs'

const FIDELITIES = new Set(['auto', 'canonical', 'native'])
const DEFAULT_BOARD_THICKNESS_MM = 1.6
const DEFAULT_MAX_ASSET_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_TOTAL_ASSET_BYTES = 512 * 1024 * 1024
const DEFAULT_RESOLVE_CONCURRENCY = 8
const MAX_ASSET_COUNT = 10_000

/**
 * Normalizes bounded options shared by the canonical scene services.
 */
export class Scene3dOptions {
    /**
     * Normalizes one public scene request without invoking accessors.
     * @param {unknown} [options] Scene options candidate.
     * @returns {{ fidelity: 'auto' | 'canonical' | 'native', boardThickness: number, boardThicknessProvided: boolean, resolveAsset: Function | null, signal: AbortSignal | null, onProgress: Function | null, maxAssetBytes: number, maxTotalAssetBytes: number, resolveConcurrency: number }} Normalized options.
     */
    static normalize(options = {}) {
        const fields = Scene3dOptions.dataRecord(options, 'Scene options')
        const fidelityValue = fields.fidelity ?? 'auto'
        if (typeof fidelityValue !== 'string') {
            throw new TypeError('Scene fidelity must be a string.')
        }
        const fidelity = fidelityValue
        if (!FIDELITIES.has(fidelity)) {
            throw new ToolkitError(
                `Unsupported scene fidelity: ${fidelity || '(empty)'}.`,
                {
                    code: 'ERR_OPTION_INVALID',
                    category: 'unsupported'
                }
            )
        }

        const boardThicknessValue = fields.boardThickness
        if (
            boardThicknessValue !== undefined &&
            typeof boardThicknessValue !== 'number' &&
            typeof boardThicknessValue !== 'string'
        ) {
            throw new TypeError(
                'Scene boardThickness must be a number or unit string.'
            )
        }
        const boardThickness =
            boardThicknessValue === undefined
                ? DEFAULT_BOARD_THICKNESS_MM
                : CircuitJsonUnits.optionalLength(boardThicknessValue)
        if (
            boardThickness === null ||
            boardThickness <= 0 ||
            boardThickness > 1000
        ) {
            throw new ToolkitError(
                'Scene boardThickness must be a positive millimeter value no greater than 1000.',
                {
                    code: 'ERR_OPTION_INVALID',
                    category: 'unsupported'
                }
            )
        }

        const resolveAsset = Scene3dOptions.#optionalFunction(
            fields.resolveAsset,
            'resolveAsset'
        )
        const onProgress = Scene3dOptions.#optionalFunction(
            fields.onProgress,
            'onProgress'
        )
        const signal = Scene3dOptions.#signal(fields.signal)

        return {
            fidelity,
            boardThickness,
            boardThicknessProvided: fields.boardThickness !== undefined,
            resolveAsset,
            signal,
            onProgress,
            maxAssetBytes: Scene3dOptions.#positiveInteger(
                fields.maxAssetBytes,
                DEFAULT_MAX_ASSET_BYTES,
                Number.MAX_SAFE_INTEGER,
                'maxAssetBytes'
            ),
            maxTotalAssetBytes: Scene3dOptions.#positiveInteger(
                fields.maxTotalAssetBytes,
                DEFAULT_MAX_TOTAL_ASSET_BYTES,
                Number.MAX_SAFE_INTEGER,
                'maxTotalAssetBytes'
            ),
            resolveConcurrency: Scene3dOptions.#positiveInteger(
                fields.resolveConcurrency,
                DEFAULT_RESOLVE_CONCURRENCY,
                DEFAULT_RESOLVE_CONCURRENCY,
                'resolveConcurrency'
            )
        }
    }

    /**
     * Returns a null-prototype map of own data properties.
     * @param {unknown} value Record candidate.
     * @param {string} label Human-readable record label.
     * @returns {Record<string, any>} Data-property values.
     */
    static dataRecord(value, label) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError(`${label} must be a plain object.`)
        }

        let prototype
        try {
            prototype = Object.getPrototypeOf(value)
        } catch {
            throw new TypeError(
                `${label} must expose a plain object prototype.`
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${label} must be a plain object.`)
        }

        const result = Object.create(null)
        let keys
        try {
            keys = Reflect.ownKeys(value)
        } catch {
            throw new TypeError(`${label} keys could not be inspected safely.`)
        }
        for (const key of keys) {
            if (typeof key !== 'string') {
                throw new TypeError(`${label} may contain only string keys.`)
            }
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(value, key)
            } catch {
                throw new TypeError(
                    `${label} properties could not be inspected safely.`
                )
            }
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    `${label} may contain only data properties.`
                )
            }
            result[key] = descriptor.value
        }
        return result
    }

    /**
     * Copies one dense plain array by descriptors without invoking accessors.
     * @param {unknown} value Array candidate.
     * @param {string} label Human-readable array label.
     * @param {number} maximum Maximum item count.
     * @returns {any[]} Dense data-property values.
     */
    static dataArray(value, label, maximum) {
        if (!Array.isArray(value)) {
            throw new TypeError(`${label} must be an array.`)
        }
        let prototype
        let keys
        try {
            prototype = Object.getPrototypeOf(value)
            keys = Reflect.ownKeys(value)
        } catch {
            throw new TypeError(`${label} could not be inspected safely.`)
        }
        if (prototype !== Array.prototype) {
            throw new TypeError(`${label} must be a plain array.`)
        }
        let lengthDescriptor
        try {
            lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
        } catch {
            throw new TypeError(
                `${label} length could not be inspected safely.`
            )
        }
        const length = lengthDescriptor?.value
        if (!Number.isSafeInteger(length) || length < 0) {
            throw new TypeError(`${label} length must be a safe integer.`)
        }
        if (length > maximum) {
            throw new ToolkitError(`${label} count exceeds the safe limit.`, {
                code: 'ERR_ASSET_LIMIT',
                category: 'unsupported',
                details: { count: length, maximum }
            })
        }
        if (keys.length !== length + 1) {
            throw new TypeError(
                `${label} must be dense and contain no custom properties.`
            )
        }

        const result = new Array(length)
        for (let index = 0; index < length; index += 1) {
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(
                    value,
                    String(index)
                )
            } catch {
                throw new TypeError(
                    `${label} items could not be inspected safely.`
                )
            }
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    `${label} must contain only dense data properties.`
                )
            }
            result[index] = descriptor.value
        }
        return result
    }

    /**
     * Rejects an already-aborted request with the shared typed cancellation.
     * @param {AbortSignal | null} signal Cancellation signal.
     * @returns {void}
     */
    static assertNotAborted(signal) {
        if (!signal || !Scene3dOptions.#isAborted(signal)) return
        throw Scene3dOptions.#cancelled()
    }

    /**
     * Awaits a promise while allowing a genuine AbortSignal to win promptly.
     * @param {unknown} value Promise or value to await.
     * @param {AbortSignal | null} signal Cancellation signal.
     * @returns {Promise<any>} Settled value.
     */
    static async awaitWithSignal(value, signal) {
        if (!signal) return await value
        Scene3dOptions.assertNotAborted(signal)
        return await new Promise((resolve, reject) => {
            let settled = false
            const remove = () => {
                EventTarget.prototype.removeEventListener.call(
                    signal,
                    'abort',
                    onAbort
                )
            }
            const finish = (callback, result) => {
                if (settled) return
                settled = true
                remove()
                callback(result)
            }
            const onAbort = () => finish(reject, Scene3dOptions.#cancelled())
            EventTarget.prototype.addEventListener.call(
                signal,
                'abort',
                onAbort,
                { once: true }
            )
            Promise.resolve(value).then(
                (result) => finish(resolve, result),
                (error) => finish(reject, error)
            )
            if (Scene3dOptions.#isAborted(signal)) onAbort()
        })
    }

    /**
     * Normalizes one optional callback.
     * @param {unknown} value Callback candidate.
     * @param {string} name Option name.
     * @returns {Function | null} Callback or null.
     */
    static #optionalFunction(value, name) {
        if (value === undefined) return null
        if (typeof value !== 'function') {
            throw new TypeError(`Scene ${name} must be a function.`)
        }
        return value
    }

    /**
     * Brand-checks one optional AbortSignal without trusting lookalikes.
     * @param {unknown} value Signal candidate.
     * @returns {AbortSignal | null} Signal or null.
     */
    static #signal(value) {
        if (value === undefined || value === null) return null
        try {
            const descriptor = Object.getOwnPropertyDescriptor(
                AbortSignal.prototype,
                'aborted'
            )
            if (typeof descriptor?.get !== 'function') throw new TypeError()
            descriptor.get.call(value)
            return /** @type {AbortSignal} */ (value)
        } catch {
            throw new TypeError('Scene signal must be an AbortSignal.')
        }
    }

    /**
     * Normalizes a positive bounded integer option.
     * @param {unknown} value Candidate value.
     * @param {number} fallback Default value.
     * @param {number} maximum Maximum accepted value.
     * @param {string} name Option name.
     * @returns {number} Normalized integer.
     */
    static #positiveInteger(value, fallback, maximum, name) {
        if (value === undefined) return fallback
        if (typeof value !== 'number' && typeof value !== 'string') {
            throw new TypeError(
                `Scene ${name} must be a positive integer no greater than ${maximum}.`
            )
        }
        const number = Number(value)
        if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
            throw new TypeError(
                `Scene ${name} must be a positive integer no greater than ${maximum}.`
            )
        }
        return number
    }

    /**
     * Returns the maximum number of scene assets accepted per operation.
     * @returns {number} Asset count ceiling.
     */
    static get maxAssetCount() {
        return MAX_ASSET_COUNT
    }

    /**
     * Reads aborted state through the platform brand-checked getter.
     * @param {AbortSignal} signal Cancellation signal.
     * @returns {boolean} Whether the signal is aborted.
     */
    static #isAborted(signal) {
        const descriptor = Object.getOwnPropertyDescriptor(
            AbortSignal.prototype,
            'aborted'
        )
        return Boolean(descriptor?.get?.call(signal))
    }

    /**
     * Creates the shared scene cancellation error.
     * @returns {ToolkitError} Typed cancellation.
     */
    static #cancelled() {
        return new ToolkitError('Scene preparation was cancelled.', {
            code: 'ERR_CANCELLED',
            category: 'cancelled'
        })
    }
}
