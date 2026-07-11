import { BinaryDataSnapshot } from '../context/BinaryDataSnapshot.mjs'
import { CircuitJsonReadOnlyDocument } from '../context/CircuitJsonReadOnlyDocument.mjs'
import { AttachedValueLimits } from '../AttachedValueLimits.mjs'

const ASSET_MODES = new Set(['none', 'metadata', 'full'])
const PREPARED_ASSETS = new WeakMap()
const SCALAR_FIELDS = ['id', 'kind', 'name', 'mediaType', 'byteLength']
const MEDIA_TYPES_BY_SUFFIX = new Map([
    ['3mf', 'model/3mf'],
    ['glb', 'model/gltf-binary'],
    ['gltf', 'model/gltf+json'],
    ['iges', 'model/iges'],
    ['igs', 'model/iges'],
    ['obj', 'model/obj'],
    ['step', 'model/step'],
    ['stl', 'model/stl'],
    ['stp', 'model/step'],
    ['vrml', 'model/vrml'],
    ['wrl', 'model/vrml'],
    ['bmp', 'image/bmp'],
    ['gif', 'image/gif'],
    ['jpeg', 'image/jpeg'],
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
    ['svg', 'image/svg+xml'],
    ['webp', 'image/webp'],
    ['json', 'application/json'],
    ['pdf', 'application/pdf'],
    ['zip', 'application/zip']
])

/**
 * Normalizes embedded and external asset records through one shared ownership
 * and accounting boundary.
 */
export class ToolkitAsset {
    /**
     * Creates one full clone-safe asset record.
     * @param {Record<string, any>} [fields] Asset fields.
     * @returns {{ id: string, kind: string, name: string, mediaType: string, byteLength: number, data: any, source: any }} Normalized asset.
     */
    static create(fields = {}) {
        const prepared =
            fields && typeof fields === 'object'
                ? PREPARED_ASSETS.get(fields)
                : null
        return ToolkitAsset.prepare(
            prepared ? fields : ToolkitAsset.#legacyPayload(fields),
            { mode: 'full' }
        )
    }

    /**
     * Measures one asset's resident payload without copying it.
     * @param {unknown} fields Asset candidate.
     * @returns {number} Exact resident or declared payload byte length.
     */
    static measure(fields) {
        const prepared =
            fields && typeof fields === 'object'
                ? PREPARED_ASSETS.get(fields)
                : null
        if (prepared) return prepared.byteLength
        const descriptors = ToolkitAsset.#descriptors(fields)
        return ToolkitAsset.#payloadByteLength(
            ToolkitAsset.#dataValue(descriptors.data),
            ToolkitAsset.#dataValue(descriptors.byteLength)
        )
    }

    /**
     * Prepares one descriptor-safe asset for a requested decode mode.
     * @param {unknown} fields Asset candidate.
     * @param {{ mode?: 'none' | 'metadata' | 'full', metadataBudget?: object, acceptPayload?: (byteLength: number, identity: { id: unknown, name: unknown }) => void }} [options] Preparation options.
     * @returns {Record<string, any> | null} Prepared asset or null for none.
     */
    static prepare(fields = {}, options = {}) {
        const normalizedOptions = ToolkitAsset.#options(options)
        const existing =
            fields && typeof fields === 'object'
                ? PREPARED_ASSETS.get(fields)
                : null
        if (existing) {
            ToolkitAsset.#acceptPrepared(
                normalizedOptions.acceptPayload,
                existing,
                fields
            )
            if (normalizedOptions.mode === 'none') return null
            if (
                existing.mode === 'full' &&
                normalizedOptions.mode === 'metadata'
            ) {
                return ToolkitAsset.prepare(
                    CircuitJsonReadOnlyDocument.copyAssetMetadataFields(fields),
                    { ...normalizedOptions, acceptPayload: null }
                )
            }
            return fields
        }
        if (normalizedOptions.mode === 'none') {
            const descriptors = ToolkitAsset.#descriptors(fields)
            const byteLength = ToolkitAsset.#payloadByteLength(
                ToolkitAsset.#dataValue(descriptors.data),
                ToolkitAsset.#dataValue(descriptors.byteLength)
            )
            ToolkitAsset.#acceptPayload(
                normalizedOptions.acceptPayload,
                byteLength,
                descriptors
            )
            return null
        }

        const descriptors = ToolkitAsset.#descriptors(fields)
        const data = ToolkitAsset.#dataValue(descriptors.data)
        const byteLength = ToolkitAsset.#payloadByteLength(
            data,
            ToolkitAsset.#dataValue(descriptors.byteLength)
        )
        ToolkitAsset.#acceptPayload(
            normalizedOptions.acceptPayload,
            byteLength,
            descriptors
        )

        const kind = ToolkitAsset.#stringScalar(
            ToolkitAsset.#dataValue(descriptors.kind),
            'asset',
            'kind'
        )
        const name = ToolkitAsset.#stringScalar(
            ToolkitAsset.#dataValue(descriptors.name),
            '',
            'name'
        )
        const budget =
            normalizedOptions.metadataBudget ||
            CircuitJsonReadOnlyDocument.createMetadataBudget()
        const source = CircuitJsonReadOnlyDocument.copyReadonlyMetadataValue(
            ToolkitAsset.#dataValue(descriptors.source) ?? null,
            budget
        )
        const id = ToolkitAsset.#stringScalar(
            ToolkitAsset.#dataValue(descriptors.id),
            ToolkitAsset.#id(kind, name, source),
            'id'
        )
        const normalized = {
            id,
            kind,
            name,
            mediaType: ToolkitAsset.#stringScalar(
                ToolkitAsset.#dataValue(descriptors.mediaType),
                ToolkitAsset.#mediaTypeForName(name),
                'mediaType'
            ),
            byteLength,
            data: normalizedOptions.mode === 'full' ? (data ?? null) : null,
            source
        }
        const captured = CircuitJsonReadOnlyDocument.captureAsset(
            normalized,
            budget
        )
        PREPARED_ASSETS.set(captured, {
            byteLength,
            mode: normalizedOptions.mode
        })
        return captured
    }

    /**
     * Prepares one dense asset list through data descriptors only.
     * @param {unknown} assets Asset list candidate.
     * @param {{ mode?: 'none' | 'metadata' | 'full', metadataBudget?: object, acceptPayload?: (byteLength: number, identity: { id: unknown, name: unknown }) => void }} [options] Preparation options.
     * @returns {Record<string, any>[]} Prepared assets.
     */
    static prepareAll(assets, options = {}) {
        AttachedValueLimits.add(assets)
        const normalizedOptions = ToolkitAsset.#options(options)
        const descriptors = ToolkitAsset.#arrayDescriptors(assets)
        const length = descriptors.length.value
        const metadataBudget =
            normalizedOptions.metadataBudget ||
            CircuitJsonReadOnlyDocument.createMetadataBudget()
        const result = []
        for (let index = 0; index < length; index += 1) {
            const asset = ToolkitAsset.prepare(
                descriptors[String(index)].value,
                {
                    ...normalizedOptions,
                    metadataBudget
                }
            )
            if (asset) result.push(asset)
        }
        return result
    }

    /**
     * Reads and validates one options record without invoking accessors.
     * @param {unknown} options Options candidate.
     * @returns {{ mode: 'none' | 'metadata' | 'full', metadataBudget: object | null, acceptPayload: Function | null }} Normalized options.
     */
    static #options(options) {
        const descriptors = ToolkitAsset.#plainDescriptors(
            options,
            'Toolkit asset options must be a plain object.'
        )
        const allowed = new Set(['mode', 'metadataBudget', 'acceptPayload'])
        for (const key of Reflect.ownKeys(descriptors)) {
            if (typeof key !== 'string' || !allowed.has(key)) {
                throw new TypeError(
                    `Unsupported ToolkitAsset option: ${String(key)}.`
                )
            }
        }
        const mode = ToolkitAsset.#dataValue(descriptors.mode) ?? 'full'
        if (!ASSET_MODES.has(mode)) {
            throw new TypeError(
                'ToolkitAsset mode must be none, metadata, or full.'
            )
        }
        const acceptPayload = ToolkitAsset.#dataValue(descriptors.acceptPayload)
        if (
            acceptPayload !== undefined &&
            acceptPayload !== null &&
            typeof acceptPayload !== 'function'
        ) {
            throw new TypeError(
                'ToolkitAsset acceptPayload must be a function.'
            )
        }
        return {
            mode,
            metadataBudget:
                ToolkitAsset.#dataValue(descriptors.metadataBudget) || null,
            acceptPayload: acceptPayload || null
        }
    }

    /**
     * Reads one exact dense plain asset array.
     * @param {unknown} value Array candidate.
     * @returns {Record<string, PropertyDescriptor>} Array descriptors.
     */
    static #arrayDescriptors(value) {
        if (!Array.isArray(value)) {
            throw new TypeError('Toolkit assets must be a dense plain array.')
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw new TypeError('Toolkit assets could not be inspected safely.')
        }
        const length = ToolkitAsset.#dataValue(descriptors.length)
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            Reflect.ownKeys(descriptors).length !== length + 1
        ) {
            throw new TypeError('Toolkit assets must be a dense plain array.')
        }
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                throw new TypeError(
                    'Toolkit assets must contain enumerable data properties.'
                )
            }
        }
        return descriptors
    }

    /**
     * Reads one asset's own descriptors.
     * @param {unknown} fields Asset candidate.
     * @returns {Record<string, PropertyDescriptor>} Field descriptors.
     */
    static #descriptors(fields) {
        const descriptors = ToolkitAsset.#plainDescriptors(
            fields,
            'Toolkit asset must be a plain object.'
        )
        const allowed = new Set([...SCALAR_FIELDS, 'data', 'source'])
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                !allowed.has(key) ||
                descriptor.enumerable !== true
            ) {
                throw new TypeError(
                    'Toolkit assets may contain only canonical enumerable fields.'
                )
            }
        }
        return descriptors
    }

    /**
     * Returns data descriptors for one plain object.
     * @param {unknown} value Record candidate.
     * @param {string} message Type error message.
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
                    'Toolkit assets may contain only data properties.'
                )
            }
        }
        return descriptors
    }

    /**
     * Reads one descriptor's value.
     * @param {PropertyDescriptor | undefined} descriptor Descriptor.
     * @returns {unknown} Data value.
     */
    static #dataValue(descriptor) {
        return descriptor && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined
    }

    /**
     * Measures supported binary, textual, or external metadata payloads.
     * @param {unknown} data Asset payload.
     * @param {unknown} declaredByteLength Declared metadata byte length.
     * @returns {number} Exact byte length.
     */
    static #payloadByteLength(data, declaredByteLength) {
        const binaryLength = BinaryDataSnapshot.byteLength(data)
        if (binaryLength !== null) return binaryLength
        if (typeof data === 'string') {
            return CircuitJsonReadOnlyDocument.utf8ByteLength(data)
        }
        if (data !== null && data !== undefined) {
            throw new TypeError(
                'Toolkit asset data must be text, binary data, or null.'
            )
        }
        if (declaredByteLength === undefined) return 0
        if (
            !Number.isSafeInteger(declaredByteLength) ||
            declaredByteLength < 0
        ) {
            throw new TypeError(
                'Toolkit asset byteLength must be a non-negative safe integer.'
            )
        }
        return declaredByteLength
    }

    /**
     * Retains the historical create() fallback for unsupported payload values.
     * @param {unknown} fields Asset fields.
     * @returns {unknown} Original fields or a descriptor-preserving null payload.
     */
    static #legacyPayload(fields) {
        const descriptors = ToolkitAsset.#descriptors(fields)
        const data = ToolkitAsset.#dataValue(descriptors.data)
        if (
            data === null ||
            data === undefined ||
            typeof data === 'string' ||
            BinaryDataSnapshot.byteLength(data) !== null
        ) {
            return fields
        }
        const normalized = Object.create(Object.getPrototypeOf(fields))
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            Object.defineProperty(normalized, key, {
                ...descriptor,
                value: key === 'data' ? null : descriptor.value
            })
        }
        return normalized
    }

    /**
     * Normalizes one primitive scalar without object coercion.
     * @param {unknown} value Scalar candidate.
     * @param {string} fallback Missing fallback.
     * @param {string} field Field name.
     * @returns {string} String value.
     */
    static #stringScalar(value, fallback, field) {
        if (value === undefined || value === null || value === '') {
            return fallback
        }
        if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value)) {
            throw new TypeError(
                `Toolkit asset ${field} must be a primitive scalar.`
            )
        }
        return String(value)
    }

    /**
     * Infers a stable media type from a canonical asset path.
     * @param {string} name Asset name.
     * @returns {string} Inferred type or the binary fallback.
     */
    static #mediaTypeForName(name) {
        const path = name.split(/[?#]/u, 1)[0].toLowerCase()
        const suffix = path.split('.').at(-1) || ''
        return MEDIA_TYPES_BY_SUFFIX.get(suffix) || 'application/octet-stream'
    }

    /**
     * Runs a pre-copy payload acceptance callback.
     * @param {Function | null} acceptPayload Acceptance callback.
     * @param {number} byteLength Measured payload bytes.
     * @param {Record<string, PropertyDescriptor>} descriptors Asset descriptors.
     * @returns {void}
     */
    static #acceptPayload(acceptPayload, byteLength, descriptors) {
        if (!acceptPayload) return
        acceptPayload(byteLength, {
            id: ToolkitAsset.#dataValue(descriptors.id),
            name: ToolkitAsset.#dataValue(descriptors.name)
        })
    }

    /**
     * Applies accounting to an already prepared asset without recopying it.
     * @param {Function | null} acceptPayload Acceptance callback.
     * @param {{ byteLength: number }} prepared Private preparation state.
     * @param {Record<string, any>} fields Prepared asset.
     * @returns {void}
     */
    static #acceptPrepared(acceptPayload, prepared, fields) {
        if (!acceptPayload) return
        const descriptors = Object.getOwnPropertyDescriptors(fields)
        ToolkitAsset.#acceptPayload(
            acceptPayload,
            prepared.byteLength,
            descriptors
        )
    }

    /**
     * Creates a deterministic source-identity asset id.
     * @param {string} kind Asset kind.
     * @param {string} name Asset name.
     * @param {unknown} source Source reference.
     * @returns {string} Stable id.
     */
    static #id(kind, name, source) {
        let sourceText = ''
        try {
            sourceText = JSON.stringify(source, (_key, value) =>
                typeof value === 'bigint' ? `${value}n` : value
            )
        } catch {
            sourceText = '[cyclic-source]'
        }
        let hash = 2166136261
        for (const character of `${kind}\u0000${name}\u0000${sourceText}`) {
            hash ^= character.codePointAt(0)
            hash = Math.imul(hash, 16777619)
        }
        return `asset-${(hash >>> 0).toString(16).padStart(8, '0')}`
    }
}
