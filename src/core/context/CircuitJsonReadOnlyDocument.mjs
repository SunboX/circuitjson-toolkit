import { BinaryDataSnapshot } from './BinaryDataSnapshot.mjs'
import { CircuitJsonMetadataBoundary } from './CircuitJsonMetadataBoundary.mjs'
import { StructuredDataSnapshot } from './StructuredDataSnapshot.mjs'

const PROTECTED_ASSET_BYTES = new WeakMap()
const PROTECTED_ASSET_DATA_GETTERS = new WeakSet()
const SEALED_ASSETS = new WeakSet()
const ASSET_PAYLOAD_LENGTHS = new WeakMap()
const OWNED_METADATA_ROOTS = new WeakSet()
const METADATA_BUDGETS = new WeakMap()
const ASSET_SCALAR_FIELDS = new Set([
    'id',
    'kind',
    'name',
    'mediaType',
    'byteLength'
])

/**
 * Owns canonical document records while leaving binary views usable.
 */
export class CircuitJsonReadOnlyDocument {
    /**
     * Captures caller-owned boundaries and deeply freezes the canonical envelope.
     * @param {Record<string, any>} document Canonical document envelope.
     * @returns {Record<string, any>} The same read-only envelope.
     */
    static freeze(document) {
        const assets = CircuitJsonReadOnlyDocument.#documentAssets(document)
        const metadataState = StructuredDataSnapshot.createState()
        CircuitJsonReadOnlyDocument.#captureAssetData(assets, metadataState)
        CircuitJsonMetadataBoundary.normalize(document, assets, (value) =>
            CircuitJsonReadOnlyDocument.#captureMetadataRoot(
                value,
                metadataState
            )
        )
        CircuitJsonReadOnlyDocument.#freezeValue(document, new Set())
        return document
    }

    /**
     * Reads only an internally-created defensive asset data getter.
     * @param {PropertyDescriptor | undefined} descriptor Data descriptor.
     * @returns {{ trusted: boolean, value: unknown }} Trusted read result.
     */
    static readProtectedAssetData(descriptor) {
        if (
            !descriptor ||
            typeof descriptor.get !== 'function' ||
            descriptor.set !== undefined ||
            descriptor.enumerable !== true ||
            descriptor.configurable !== false ||
            !PROTECTED_ASSET_DATA_GETTERS.has(descriptor.get)
        ) {
            return { trusted: false, value: null }
        }
        return {
            trusted: true,
            value: Reflect.apply(descriptor.get, undefined, [])
        }
    }

    /**
     * Protects one newly owned canonical asset without first recopying it.
     * @param {Record<string, any>} asset Toolkit-owned canonical asset.
     * @returns {Record<string, any>} The same protected asset.
     */
    static protectOwnedAsset(asset) {
        CircuitJsonReadOnlyDocument.#protectAsset(asset)
        return asset
    }

    /**
     * Atomically captures one canonical asset for accounting and later ownership.
     * @param {unknown} asset Canonical asset candidate.
     * @param {object | null} [metadataBudget] Shared metadata budget token.
     * @param {boolean} [rejectFrozenBytes] Whether raw frozen bytes are invalid.
     * @param {((byteLength: number, identity: { id: unknown, name: unknown }) => void) | null} [acceptPayload] Pre-copy byte-limit check.
     * @returns {Record<string, any>} Owned asset snapshot.
     */
    static captureAsset(
        asset,
        metadataBudget = null,
        rejectFrozenBytes = false,
        acceptPayload = null
    ) {
        return CircuitJsonReadOnlyDocument.#captureAsset(
            asset,
            CircuitJsonReadOnlyDocument.#metadataState(metadataBudget),
            rejectFrozenBytes,
            acceptPayload
        )
    }

    /**
     * Validates, normalizes, and isolates one clone-safe metadata value.
     * @param {unknown} value Metadata candidate.
     * @returns {unknown} Isolated metadata snapshot.
     */
    static copyMetadataValue(value) {
        return StructuredDataSnapshot.capture(value)
    }

    /**
     * Creates a deeply frozen plain-data snapshot of clone-safe metadata.
     * @param {unknown} value Metadata candidate.
     * @returns {unknown} Deeply immutable owned metadata.
     */
    static copyReadonlyMetadataValue(value) {
        if (
            value &&
            typeof value === 'object' &&
            OWNED_METADATA_ROOTS.has(value) &&
            Object.isFrozen(value)
        ) {
            return value
        }
        const snapshot = CircuitJsonReadOnlyDocument.copyMetadataValue(value)
        CircuitJsonReadOnlyDocument.#freezeValue(snapshot, new Set())
        if (snapshot && typeof snapshot === 'object') {
            OWNED_METADATA_ROOTS.add(snapshot)
        }
        return snapshot
    }

    /**
     * Creates an opaque request-global source-metadata traversal budget.
     * @returns {object} Branded metadata budget token.
     */
    static createMetadataBudget() {
        const budget = Object.freeze({})
        METADATA_BUDGETS.set(budget, StructuredDataSnapshot.createState())
        return budget
    }

    /**
     * Measures UTF-8 text without allocating encoded bytes.
     * @param {string} value Text payload.
     * @returns {number} UTF-8 byte length.
     */
    static utf8ByteLength(value) {
        if (typeof value !== 'string') {
            throw new TypeError('Expected a string payload.')
        }
        return CircuitJsonReadOnlyDocument.#utf8ByteLength(value)
    }

    /**
     * Copies one canonical asset through its trusted defensive payload slot.
     * @param {unknown} asset Canonical asset candidate.
     * @returns {Record<string, any>} Own data fields with copied payload bytes.
     */
    static copyAssetFields(asset) {
        return CircuitJsonReadOnlyDocument.#copyAssetFields(asset, true)
    }

    /**
     * Copies canonical asset metadata without materializing payload bytes.
     * @param {unknown} asset Canonical asset candidate.
     * @returns {Record<string, any>} Own metadata fields with null data.
     */
    static copyAssetMetadataFields(asset) {
        return CircuitJsonReadOnlyDocument.#copyAssetFields(asset, false)
    }

    /**
     * Returns the payload length captured with the owned asset value.
     * @param {unknown} asset Canonical asset candidate.
     * @param {object | null} [metadataBudget] Shared metadata budget token.
     * @returns {number} Exact resident payload byte length.
     */
    static assetPayloadByteLength(asset, metadataBudget = null) {
        const captured = CircuitJsonReadOnlyDocument.#captureAsset(
            asset,
            CircuitJsonReadOnlyDocument.#metadataState(metadataBudget)
        )
        return ASSET_PAYLOAD_LENGTHS.get(captured)
    }

    /**
     * Reads scalar/index fields while retaining already-owned source metadata.
     * @param {unknown} asset Canonical asset candidate.
     * @param {object | null} [metadataBudget] Shared metadata budget token.
     * @returns {Record<string, any>} Descriptor-safe index fields.
     */
    static copyAssetIndexFields(asset, metadataBudget = null) {
        return CircuitJsonReadOnlyDocument.#copyAssetFields(
            asset,
            false,
            false,
            CircuitJsonReadOnlyDocument.#metadataState(metadataBudget)
        )
    }

    /**
     * Reads the optional document asset array as an own data property.
     * @param {unknown} document Canonical document envelope.
     * @returns {unknown} Asset array candidate.
     */
    static #documentAssets(document) {
        if (!document || typeof document !== 'object') return undefined
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(document, 'assets')
        } catch {
            throw new TypeError(
                'Canonical document assets could not be inspected safely.'
            )
        }
        if (!descriptor) return undefined
        if (!Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(
                'Canonical document assets must be an own data property.'
            )
        }
        return descriptor.value
    }

    /**
     * Captures one asset with a single caller-owned descriptor traversal.
     * @param {unknown} asset Canonical asset candidate.
     * @param {{ seen: Map<object, unknown>, items: number }} metadataState Shared metadata state.
     * @param {boolean} [rejectFrozenBytes] Whether raw frozen bytes are invalid.
     * @param {((byteLength: number, identity: { id: unknown, name: unknown }) => void) | null} [acceptPayload] Pre-copy byte-limit check.
     * @returns {Record<string, any>} Owned sealed asset.
     */
    static #captureAsset(
        asset,
        metadataState,
        rejectFrozenBytes = false,
        acceptPayload = null
    ) {
        if (SEALED_ASSETS.has(asset)) return asset
        if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
            throw new TypeError('Canonical asset must be a plain object.')
        }
        const previouslyCaptured = metadataState.seen.get(asset)
        if (SEALED_ASSETS.has(previouslyCaptured)) return previouslyCaptured
        let prototype
        let keys
        try {
            prototype = Object.getPrototypeOf(asset)
            keys = Reflect.ownKeys(asset)
        } catch {
            throw new TypeError(
                'Canonical asset must expose inspectable plain object data.'
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError('Canonical asset must be a plain object.')
        }

        const fields = []
        const identity = { id: undefined, name: undefined }
        let payloadLength = null
        let binaryPayload = false
        for (const key of keys) {
            if (typeof key !== 'string') {
                throw new TypeError('Canonical asset keys must be strings.')
            }
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(asset, key)
            } catch {
                throw new TypeError(
                    'Canonical asset properties could not be inspected.'
                )
            }
            if (!descriptor) {
                throw new TypeError(
                    'Canonical asset properties changed during inspection.'
                )
            }
            if (key === 'data' && PROTECTED_ASSET_BYTES.has(asset)) {
                const bytes = PROTECTED_ASSET_BYTES.get(asset)
                fields.push({ key, descriptor, bytes, range: null })
                payloadLength = bytes.byteLength
                binaryPayload = true
                continue
            }
            if (!Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    'Canonical assets may contain only data properties.'
                )
            }
            if (ASSET_SCALAR_FIELDS.has(key)) {
                CircuitJsonReadOnlyDocument.#validateAssetScalar(
                    key,
                    descriptor.value
                )
            }
            if (key === 'id' || key === 'name') {
                identity[key] = descriptor.value
            }
            let range = null
            if (key === 'data') {
                CircuitJsonReadOnlyDocument.#validateAssetPayload(
                    descriptor.value
                )
                range = BinaryDataSnapshot.describe(descriptor.value)
                if (range) {
                    payloadLength = range.byteLength
                    binaryPayload = true
                } else {
                    payloadLength =
                        typeof descriptor.value === 'string'
                            ? CircuitJsonReadOnlyDocument.#utf8ByteLength(
                                  descriptor.value
                              )
                            : 0
                }
            }
            fields.push({ key, descriptor, bytes: null, range })
        }
        if (payloadLength === null) {
            throw new TypeError(
                'Canonical asset data must be an own data property.'
            )
        }
        if (binaryPayload && rejectFrozenBytes && Object.isFrozen(asset)) {
            throw new TypeError(
                'Frozen canonical asset bytes cannot be protected.'
            )
        }
        if (acceptPayload !== null) {
            if (typeof acceptPayload !== 'function') {
                throw new TypeError('Asset payload check must be a function.')
            }
            acceptPayload(payloadLength, identity)
        }

        const result = Object.create(prototype)
        metadataState.seen.set(asset, result)
        for (const field of fields) {
            if (field.key === 'data' && field.bytes) {
                CircuitJsonReadOnlyDocument.#defineProtectedData(
                    result,
                    new Uint8Array(field.bytes),
                    field.descriptor.enumerable
                )
                continue
            }
            if (field.key === 'source') {
                const source = CircuitJsonReadOnlyDocument.#captureMetadataRoot(
                    field.descriptor.value,
                    metadataState
                )
                Object.defineProperty(result, field.key, {
                    ...field.descriptor,
                    value: source
                })
                continue
            }
            if (field.key === 'data' && field.range) {
                CircuitJsonReadOnlyDocument.#defineProtectedData(
                    result,
                    BinaryDataSnapshot.copyBytes(
                        field.descriptor.value,
                        field.range
                    ),
                    field.descriptor.enumerable
                )
                continue
            }
            Object.defineProperty(result, field.key, field.descriptor)
        }
        SEALED_ASSETS.add(result)
        ASSET_PAYLOAD_LENGTHS.set(result, payloadLength)
        return result
    }

    /**
     * Copies one already-captured asset with optional payload materialization.
     * @param {unknown} asset Canonical asset candidate.
     * @param {boolean} includeData Whether to copy payload bytes.
     * @param {boolean} [copySource] Whether to isolate source metadata.
     * @param {{ seen: Map<object, unknown>, items: number } | null} [metadataState] Shared metadata state.
     * @returns {Record<string, any>} Copied fields.
     */
    static #copyAssetFields(
        asset,
        includeData,
        copySource = true,
        metadataState = null
    ) {
        const captured = CircuitJsonReadOnlyDocument.#captureAsset(
            asset,
            metadataState || StructuredDataSnapshot.createState()
        )
        const result = Object.create(null)
        let keys
        try {
            keys = Reflect.ownKeys(captured)
        } catch {
            throw new TypeError('Canonical asset keys could not be inspected.')
        }
        for (const key of keys) {
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(captured, key)
            } catch {
                throw new TypeError(
                    'Canonical asset properties could not be inspected.'
                )
            }
            if (key === 'data' && PROTECTED_ASSET_BYTES.has(captured)) {
                result.data = includeData
                    ? new Uint8Array(PROTECTED_ASSET_BYTES.get(captured))
                    : null
                continue
            }
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    'Canonical assets may contain only data properties.'
                )
            }
            if (key === 'source') {
                result.source = copySource
                    ? StructuredDataSnapshot.capture(descriptor.value)
                    : descriptor.value
                continue
            }
            result[key] =
                key === 'data' && !includeData ? null : descriptor.value
        }
        return result
    }

    /**
     * Rejects object coercion in canonical scalar asset fields.
     * @param {string} key Asset field name.
     * @param {unknown} value Asset field value.
     * @returns {void}
     */
    static #validateAssetScalar(key, value) {
        const type = typeof value
        if (
            value === null ||
            value === undefined ||
            ['string', 'number', 'boolean', 'bigint'].includes(type)
        ) {
            return
        }
        throw new TypeError(
            `Canonical asset ${key} must be a primitive scalar.`
        )
    }

    /**
     * Rejects unsupported or coercion-capable asset payload values.
     * @param {unknown} value Asset data value.
     * @returns {void}
     */
    static #validateAssetPayload(value) {
        if (
            value === null ||
            value === undefined ||
            typeof value === 'string' ||
            BinaryDataSnapshot.byteLength(value) !== null
        ) {
            return
        }
        throw new TypeError(
            'Canonical asset data must be text, binary data, or null.'
        )
    }

    /**
     * Resolves an opaque metadata budget token or creates local capture state.
     * @param {object | null} budget Metadata budget token.
     * @returns {{ seen: Map<object, unknown>, items: number }} Capture state.
     */
    static #metadataState(budget) {
        if (budget === null || budget === undefined) {
            return StructuredDataSnapshot.createState()
        }
        const state = METADATA_BUDGETS.get(budget)
        if (!state) throw new TypeError('Invalid source-metadata budget.')
        return state
    }

    /**
     * Captures and brands one metadata root for idempotent document sealing.
     * @param {unknown} value Metadata candidate.
     * @param {{ seen: Map<object, unknown>, items: number }} state Capture state.
     * @returns {unknown} Owned normalized root.
     */
    static #captureMetadataRoot(value, state) {
        if (
            value &&
            typeof value === 'object' &&
            OWNED_METADATA_ROOTS.has(value)
        ) {
            return value
        }
        const snapshot = StructuredDataSnapshot.capture(value, state)
        if (snapshot && typeof snapshot === 'object') {
            OWNED_METADATA_ROOTS.add(snapshot)
        }
        return snapshot
    }

    /**
     * Replaces every dense array item with its captured asset snapshot.
     * @param {unknown} assets Canonical asset array candidate.
     * @param {{ seen: Map<object, unknown>, items: number }} metadataState Shared metadata state.
     * @returns {void}
     */
    static #captureAssetData(assets, metadataState) {
        if (!Array.isArray(assets)) return
        let prototype
        let keys
        let lengthDescriptor
        try {
            prototype = Object.getPrototypeOf(assets)
            keys = Reflect.ownKeys(assets)
            lengthDescriptor = Object.getOwnPropertyDescriptor(assets, 'length')
        } catch {
            throw new TypeError(
                'Canonical assets must expose a dense plain array.'
            )
        }
        const length = lengthDescriptor?.value
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            keys.length !== length + 1
        ) {
            throw new TypeError(
                'Canonical assets must expose a dense plain array.'
            )
        }
        for (let index = 0; index < length; index += 1) {
            let itemDescriptor
            try {
                itemDescriptor = Object.getOwnPropertyDescriptor(
                    assets,
                    String(index)
                )
            } catch {
                throw new TypeError(
                    'Canonical assets could not be inspected safely.'
                )
            }
            if (!itemDescriptor || !Object.hasOwn(itemDescriptor, 'value')) {
                throw new TypeError(
                    'Canonical assets must contain only dense data properties.'
                )
            }
            const captured = CircuitJsonReadOnlyDocument.#captureAsset(
                itemDescriptor.value,
                metadataState,
                true
            )
            if (captured !== itemDescriptor.value) {
                Object.defineProperty(assets, String(index), {
                    ...itemDescriptor,
                    value: captured
                })
            }
        }
    }

    /**
     * Protects one toolkit-owned binary asset before it crosses a public boundary.
     * @param {unknown} asset Canonical asset candidate.
     * @returns {void}
     */
    static #protectAsset(asset) {
        if (!asset || typeof asset !== 'object') return
        if (PROTECTED_ASSET_BYTES.has(asset)) return
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(asset, 'data')
        } catch {
            throw new TypeError(
                'Canonical asset data could not be inspected safely.'
            )
        }
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(
                'Canonical asset data must be an own data property.'
            )
        }
        CircuitJsonReadOnlyDocument.#validateAssetPayload(descriptor.value)
        const range = BinaryDataSnapshot.describe(descriptor.value)
        if (!range) return
        if (Object.isFrozen(asset)) {
            throw new TypeError(
                'Frozen canonical asset bytes cannot be protected.'
            )
        }
        CircuitJsonReadOnlyDocument.#defineProtectedData(
            asset,
            BinaryDataSnapshot.copyBytes(descriptor.value, range),
            descriptor.enumerable
        )
    }

    /**
     * Installs one private byte snapshot and a defensive-copy getter.
     * @param {object} asset Owned asset.
     * @param {Uint8Array} bytes Isolated bytes.
     * @param {boolean} enumerable Original enumerability.
     * @returns {void}
     */
    static #defineProtectedData(asset, bytes, enumerable) {
        PROTECTED_ASSET_BYTES.set(asset, bytes)
        /** @returns {Uint8Array} A defensive payload copy. */
        const readAssetData = () => new Uint8Array(bytes)
        PROTECTED_ASSET_DATA_GETTERS.add(readAssetData)
        Object.defineProperty(asset, 'data', {
            configurable: false,
            enumerable,
            get: readAssetData
        })
    }

    /**
     * Measures UTF-8 bytes without allocating an encoded copy.
     * @param {string} value Text payload.
     * @returns {number} UTF-8 byte length.
     */
    static #utf8ByteLength(value) {
        let length = 0
        for (const character of value) {
            const codePoint = character.codePointAt(0)
            length +=
                codePoint <= 0x7f
                    ? 1
                    : codePoint <= 0x7ff
                      ? 2
                      : codePoint <= 0xffff
                        ? 3
                        : 4
        }
        return length
    }

    /**
     * Freezes one owned clone-safe container in child-first order.
     * @param {unknown} value Candidate value.
     * @param {Set<object>} seen Visited object identities.
     * @returns {void}
     */
    static #freezeValue(value, seen) {
        if (!CircuitJsonReadOnlyDocument.#container(value)) return
        if (seen.has(value)) return
        seen.add(value)
        let keys
        try {
            keys = Reflect.ownKeys(value)
        } catch {
            throw new TypeError(
                'Canonical document values could not be inspected safely.'
            )
        }
        for (const key of keys) {
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(value, key)
            } catch {
                throw new TypeError(
                    'Canonical document properties could not be inspected safely.'
                )
            }
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                const protectedData =
                    key === 'data' && PROTECTED_ASSET_BYTES.has(value)
                if (protectedData) continue
                throw new TypeError(
                    'Canonical document may contain only data properties.'
                )
            }
            CircuitJsonReadOnlyDocument.#freezeValue(descriptor.value, seen)
        }
        try {
            Object.freeze(value)
        } catch {
            throw new TypeError(
                'Canonical document values could not be frozen safely.'
            )
        }
    }

    /**
     * Returns true for containers that can be frozen without breaking views.
     * @param {unknown} value Candidate value.
     * @returns {boolean} Whether the value is a supported container.
     */
    static #container(value) {
        if (!value || typeof value !== 'object') return false
        try {
            if (BinaryDataSnapshot.byteLength(value) !== null) return false
            if (Array.isArray(value)) return true
            const prototype = Object.getPrototypeOf(value)
            return prototype === Object.prototype || prototype === null
        } catch {
            throw new TypeError(
                'Canonical document values could not be inspected safely.'
            )
        }
    }
}

Object.freeze(CircuitJsonReadOnlyDocument.prototype)
Object.freeze(CircuitJsonReadOnlyDocument)
