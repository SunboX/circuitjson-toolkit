import { ToolkitAsset } from '../contracts/ToolkitAsset.mjs'
import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { ToolkitProgress } from '../contracts/ToolkitProgress.mjs'
import { BinaryDataSnapshot } from '../context/BinaryDataSnapshot.mjs'
import { CircuitJsonReadOnlyDocument } from '../context/CircuitJsonReadOnlyDocument.mjs'
import { Scene3dOptions } from './Scene3dOptions.mjs'

/**
 * Resolves scene assets only through an explicitly injected callback.
 */
export class SceneAssetResolver {
    /**
     * Resolves a bounded asset list while preserving request order.
     * @param {unknown} requests Asset request records.
     * @param {unknown} [options] Resolution options.
     * @returns {Promise<object[]>} Resolved canonical asset records.
     */
    static async resolveAll(requests, options = {}) {
        const requestValues = Scene3dOptions.dataArray(
            requests,
            'Scene assets',
            Scene3dOptions.maxAssetCount
        )
        const normalized = Scene3dOptions.normalize(options)
        Scene3dOptions.assertNotAborted(normalized.signal)
        const capturedRequests = SceneAssetResolver.#preflightResident(
            requestValues,
            normalized
        )
        const assets = capturedRequests.map((request) =>
            SceneAssetResolver.#request(request)
        )
        if (!assets.length) return []

        let previous = SceneAssetResolver.#progress(
            normalized,
            {
                stage: 'decode',
                detail: 'scene-assets',
                completed: 0,
                total: assets.length
            },
            null
        )
        const results = new Array(assets.length)
        let totalBytes = 0

        for (
            let start = 0;
            start < assets.length;
            start += normalized.resolveConcurrency
        ) {
            Scene3dOptions.assertNotAborted(normalized.signal)
            const end = Math.min(
                start + normalized.resolveConcurrency,
                assets.length
            )
            const batch = []
            for (let index = start; index < end; index += 1) {
                batch.push(
                    SceneAssetResolver.#resolveOne(assets[index], normalized)
                )
            }
            const resolvedBatch = await Promise.all(batch)
            for (let offset = 0; offset < resolvedBatch.length; offset += 1) {
                const index = start + offset
                const resolved = resolvedBatch[offset]
                const range =
                    typeof resolved.data === 'string'
                        ? null
                        : BinaryDataSnapshot.describe(resolved.data)
                const byteLength = SceneAssetResolver.#byteLength(
                    resolved.data,
                    range
                )
                if (byteLength > normalized.maxAssetBytes) {
                    throw SceneAssetResolver.#limitError(
                        resolved.request,
                        byteLength,
                        normalized.maxAssetBytes,
                        'asset'
                    )
                }
                if (totalBytes + byteLength > normalized.maxTotalAssetBytes) {
                    throw SceneAssetResolver.#limitError(
                        resolved.request,
                        totalBytes + byteLength,
                        normalized.maxTotalAssetBytes,
                        'total'
                    )
                }
                const asset = SceneAssetResolver.#assetWithData(
                    resolved.request,
                    resolved.data,
                    range
                )
                totalBytes += byteLength
                results[index] = asset
                previous = SceneAssetResolver.#progress(
                    normalized,
                    {
                        stage: 'decode',
                        detail: 'scene-assets',
                        completed: index + 1,
                        total: assets.length
                    },
                    previous
                )
                Scene3dOptions.assertNotAborted(normalized.signal)
            }
        }

        Scene3dOptions.assertNotAborted(normalized.signal)
        SceneAssetResolver.#progress(
            normalized,
            {
                stage: 'complete',
                detail: 'scene-assets',
                completed: assets.length,
                total: assets.length
            },
            previous
        )
        Scene3dOptions.assertNotAborted(normalized.signal)
        return results
    }

    /**
     * Normalizes one public asset request without invoking accessors.
     * @param {unknown} request Asset request candidate.
     * @returns {object} Canonical asset record.
     */
    static #request(request) {
        const fields = CircuitJsonReadOnlyDocument.copyAssetFields(request)
        const asset = ToolkitAsset.create(fields)
        if (!asset.id) {
            throw new TypeError('Scene asset request id must not be empty.')
        }
        return asset
    }

    /**
     * Bounds all resident request data before normalization can copy or encode it.
     * @param {object[]} requests Descriptor-safe request records.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Normalized options.
     * @returns {object[]} Atomically captured request records.
     */
    static #preflightResident(requests, options) {
        const metadataBudget =
            CircuitJsonReadOnlyDocument.createMetadataBudget()
        let totalBytes = 0
        const captured = new Array(requests.length)
        for (let index = 0; index < requests.length; index += 1) {
            const request = CircuitJsonReadOnlyDocument.captureAsset(
                requests[index],
                metadataBudget,
                false,
                (byteLength, identity) => {
                    if (byteLength > options.maxAssetBytes) {
                        throw SceneAssetResolver.#preflightLimitError(
                            identity,
                            byteLength,
                            options.maxAssetBytes,
                            'asset'
                        )
                    }
                    if (totalBytes + byteLength > options.maxTotalAssetBytes) {
                        throw SceneAssetResolver.#preflightLimitError(
                            identity,
                            totalBytes + byteLength,
                            options.maxTotalAssetBytes,
                            'total'
                        )
                    }
                }
            )
            captured[index] = request
            const byteLength =
                CircuitJsonReadOnlyDocument.assetPayloadByteLength(
                    request,
                    metadataBudget
                )
            if (byteLength > options.maxAssetBytes) {
                throw SceneAssetResolver.#candidateLimitError(
                    request,
                    byteLength,
                    options.maxAssetBytes,
                    'asset'
                )
            }
            totalBytes += byteLength
            if (totalBytes > options.maxTotalAssetBytes) {
                throw SceneAssetResolver.#candidateLimitError(
                    request,
                    totalBytes,
                    options.maxTotalAssetBytes,
                    'total'
                )
            }
        }
        return captured
    }

    /**
     * Creates a byte-limit error before payload or source metadata is copied.
     * @param {{ id: unknown, name: unknown }} identity Captured primitive identity.
     * @param {number} actual Actual resident bytes.
     * @param {number} maximum Maximum bytes.
     * @param {'asset' | 'total'} scope Limit scope.
     * @returns {ToolkitError} Typed limit error.
     */
    static #preflightLimitError(identity, actual, maximum, scope) {
        return SceneAssetResolver.#limitError(
            {
                id: SceneAssetResolver.#primitiveText(identity.id),
                name: SceneAssetResolver.#primitiveText(identity.name)
            },
            actual,
            maximum,
            scope
        )
    }

    /**
     * Converts an already-validated primitive identity without object coercion.
     * @param {unknown} value Primitive identity field.
     * @returns {string} Text identity.
     */
    static #primitiveText(value) {
        return value === null || value === undefined ? '' : String(value)
    }

    /**
     * Creates a limit error from metadata-only request normalization.
     * @param {object} request Asset request candidate.
     * @param {number} actual Actual bytes.
     * @param {number} maximum Maximum bytes.
     * @param {'asset' | 'total'} scope Limit scope.
     * @returns {ToolkitError} Typed limit error.
     */
    static #candidateLimitError(request, actual, maximum, scope) {
        const metadata = ToolkitAsset.create(
            CircuitJsonReadOnlyDocument.copyAssetMetadataFields(request)
        )
        return SceneAssetResolver.#limitError(metadata, actual, maximum, scope)
    }

    /**
     * Resolves or copies one asset payload.
     * @param {object} request Canonical asset request.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Normalized options.
     * @returns {Promise<{ request: object, data: string | ArrayBuffer | ArrayBufferView }>} Resolved request and payload.
     */
    static async #resolveOne(request, options) {
        Scene3dOptions.assertNotAborted(options.signal)
        if (request.data !== null) {
            return { request, data: request.data }
        }
        if (!options.resolveAsset) {
            throw SceneAssetResolver.#missingData(request)
        }

        let pending
        try {
            pending = options.resolveAsset(
                SceneAssetResolver.#resolverRequest(request),
                { signal: options.signal }
            )
        } catch (error) {
            throw new ToolkitError(
                `Unable to resolve scene asset: ${request.id}.`,
                {
                    code: 'ERR_ASSET_RESOLUTION',
                    category: 'runtime',
                    source: request.name,
                    details: { assetId: request.id },
                    cause: error
                }
            )
        }
        let result
        try {
            result = await Scene3dOptions.awaitWithSignal(
                pending,
                options.signal
            )
        } catch (error) {
            if (
                error instanceof ToolkitError &&
                error.code === 'ERR_CANCELLED'
            ) {
                throw error
            }
            throw new ToolkitError(
                `Unable to resolve scene asset: ${request.id}.`,
                {
                    code: 'ERR_ASSET_RESOLUTION',
                    category: 'runtime',
                    source: request.name,
                    details: { assetId: request.id },
                    cause: error
                }
            )
        }
        Scene3dOptions.assertNotAborted(options.signal)
        const data = SceneAssetResolver.#resolvedData(result)
        if (data === null) throw SceneAssetResolver.#missingData(request)
        return { request, data }
    }

    /**
     * Creates a clone-safe resolver request without copying absent payload data.
     * @param {object} request Canonical request.
     * @returns {object} Resolver request.
     */
    static #resolverRequest(request) {
        return {
            id: request.id,
            kind: request.kind,
            name: request.name,
            mediaType: request.mediaType,
            byteLength: request.byteLength,
            data: null,
            source: CircuitJsonReadOnlyDocument.copyMetadataValue(
                request.source
            )
        }
    }

    /**
     * Extracts one supported payload from a resolver return value.
     * @param {unknown} result Resolver return value.
     * @returns {string | ArrayBuffer | ArrayBufferView | null} Payload.
     */
    static #resolvedData(result) {
        if (SceneAssetResolver.#isPayload(result)) return result
        if (result === null || result === undefined) return null
        const fields = Scene3dOptions.dataRecord(result, 'Resolved scene asset')
        return SceneAssetResolver.#isPayload(fields.data) ? fields.data : null
    }

    /**
     * Copies and bounds one resolved asset payload.
     * @param {object} request Asset request.
     * @param {string | ArrayBuffer | ArrayBufferView} data Resolved payload.
     * @param {{ buffer: ArrayBuffer | SharedArrayBuffer, byteOffset: number, byteLength: number } | null} range Captured binary range.
     * @returns {object} Canonical asset with copied data.
     */
    static #assetWithData(request, data, range) {
        const copiedData =
            typeof data === 'string'
                ? data
                : BinaryDataSnapshot.copyBytes(data, range)
        return ToolkitAsset.create({
            id: request.id,
            kind: request.kind,
            name: request.name,
            mediaType: request.mediaType,
            data: copiedData,
            source: request.source
        })
    }

    /**
     * Measures a supported payload without copying oversized binary inputs.
     * @param {string | ArrayBuffer | ArrayBufferView} data Payload.
     * @param {{ byteLength: number } | null} [range] Captured binary range.
     * @returns {number} Byte length.
     */
    static #byteLength(data, range = null) {
        if (typeof data === 'string') {
            return CircuitJsonReadOnlyDocument.utf8ByteLength(data)
        }
        return range?.byteLength ?? BinaryDataSnapshot.byteLength(data) ?? 0
    }

    /**
     * Returns true for supported textual or binary payloads.
     * @param {unknown} value Payload candidate.
     * @returns {boolean} Whether the value is supported.
     */
    static #isPayload(value) {
        return (
            typeof value === 'string' ||
            BinaryDataSnapshot.byteLength(value) !== null
        )
    }

    /**
     * Creates the shared missing-data failure.
     * @param {object} request Asset request.
     * @returns {ToolkitError} Typed failure.
     */
    static #missingData(request) {
        return new ToolkitError(
            `Scene asset data is required: ${request.id}.`,
            {
                code: 'ERR_ASSET_DATA_REQUIRED',
                category: 'unsupported',
                source: request.name,
                details: { assetId: request.id }
            }
        )
    }

    /**
     * Creates one asset size-limit failure.
     * @param {object} request Asset request.
     * @param {number} actual Actual bytes.
     * @param {number} maximum Maximum bytes.
     * @param {'asset' | 'total'} scope Limit scope.
     * @returns {ToolkitError} Typed failure.
     */
    static #limitError(request, actual, maximum, scope) {
        return new ToolkitError('Scene asset bytes exceed the safe limit.', {
            code: 'ERR_ASSET_LIMIT',
            category: 'unsupported',
            source: request.name,
            details: {
                assetId: request.id,
                scope,
                actual,
                maximum
            }
        })
    }

    /**
     * Emits one ordered progress row when a callback is installed.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Normalized options.
     * @param {object} fields Progress fields.
     * @param {object | null} previous Previous row.
     * @returns {object | null} Emitted row or previous value.
     */
    static #progress(options, fields, previous) {
        if (!options.onProgress) return previous
        const row = ToolkitProgress.create(fields, previous)
        options.onProgress(row)
        return row
    }
}
