import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { CircuitJsonReadOnlyDocument } from '../context/CircuitJsonReadOnlyDocument.mjs'
import { Scene3dOptions } from './Scene3dOptions.mjs'

const DOCUMENT_SCHEMA = 'ecad-toolkit.document.v1'
const ENVELOPE_FIELDS = ['schema', 'model', 'source', 'extensions', 'assets']

/**
 * Rejects unsafe envelopes and resident asset limits before context copying.
 */
export class Scene3dInputPreflight {
    /**
     * Preflights one document envelope without invoking caller accessors.
     * @param {unknown} input Scene input.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Scene options.
     * @returns {boolean} Whether envelope assets were preflighted.
     */
    static check(input, options) {
        if (Array.isArray(input) || !input || typeof input !== 'object') {
            return false
        }
        const schema = Scene3dInputPreflight.#descriptor(input, 'schema')
        if (!schema) return false
        if (!Object.hasOwn(schema, 'value')) {
            throw new TypeError(
                'Canonical document schema must be an own data property.'
            )
        }
        if (schema.value !== DOCUMENT_SCHEMA) return false

        const values = Object.create(null)
        for (const field of ENVELOPE_FIELDS) {
            const descriptor = Scene3dInputPreflight.#descriptor(input, field)
            if (!descriptor) {
                if (field === 'schema' || field === 'model') {
                    throw new TypeError(
                        `Canonical document ${field} must be an own data property.`
                    )
                }
                values[field] = undefined
                continue
            }
            if (!Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    `Canonical document ${field} must be an own data property.`
                )
            }
            values[field] = descriptor.value
        }
        Scene3dInputPreflight.checkAssets(values.assets, options)
        return true
    }

    /**
     * Applies one global metadata and resident-byte budget to document assets.
     * @param {unknown} values Canonical document assets.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Scene options.
     * @returns {object[]} Captured assets in authored order.
     */
    static checkAssets(values, options) {
        const owner = values === undefined ? [] : values
        const assets = Scene3dOptions.dataArray(
            owner,
            'Scene assets',
            Scene3dOptions.maxAssetCount
        )
        const metadataBudget =
            CircuitJsonReadOnlyDocument.createMetadataBudget()
        let total = 0
        for (let index = 0; index < assets.length; index += 1) {
            const asset = assets[index]
            const captured = CircuitJsonReadOnlyDocument.captureAsset(
                asset,
                metadataBudget,
                true,
                (bytes, identity) => {
                    const assetId =
                        typeof identity.id === 'string' ? identity.id : ''
                    if (bytes > options.maxAssetBytes) {
                        throw Scene3dInputPreflight.#limit(
                            bytes,
                            options.maxAssetBytes,
                            'asset',
                            assetId
                        )
                    }
                    if (total + bytes > options.maxTotalAssetBytes) {
                        throw Scene3dInputPreflight.#limit(
                            total + bytes,
                            options.maxTotalAssetBytes,
                            'total',
                            assetId
                        )
                    }
                }
            )
            assets[index] = captured
            Scene3dInputPreflight.#replaceAsset(owner, index, asset, captured)
            const bytes = CircuitJsonReadOnlyDocument.assetPayloadByteLength(
                captured,
                metadataBudget
            )
            const assetId = Scene3dInputPreflight.#assetId(captured)
            if (bytes > options.maxAssetBytes) {
                throw Scene3dInputPreflight.#limit(
                    bytes,
                    options.maxAssetBytes,
                    'asset',
                    assetId
                )
            }
            total += bytes
            if (total > options.maxTotalAssetBytes) {
                throw Scene3dInputPreflight.#limit(
                    total,
                    options.maxTotalAssetBytes,
                    'total',
                    assetId
                )
            }
        }
        return assets
    }

    /**
     * Replaces one caller array item with the exact preflight snapshot.
     * @param {object[]} owner Original dense asset array.
     * @param {number} index Asset index.
     * @param {object} asset Original asset.
     * @param {object} captured Owned asset snapshot.
     * @returns {void}
     */
    static #replaceAsset(owner, index, asset, captured) {
        if (asset === captured) return
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(owner, String(index))
            Object.defineProperty(owner, String(index), {
                ...descriptor,
                value: captured
            })
        } catch {
            throw new TypeError(
                'Canonical document assets could not be captured safely.'
            )
        }
    }

    /**
     * Reads one own descriptor and normalizes proxy failures.
     * @param {object} owner Envelope candidate.
     * @param {string} key Field name.
     * @returns {PropertyDescriptor | undefined} Own descriptor.
     */
    static #descriptor(owner, key) {
        try {
            return Object.getOwnPropertyDescriptor(owner, key)
        } catch {
            throw new TypeError(
                'Canonical document could not be inspected safely.'
            )
        }
    }

    /**
     * Reads one validated asset identifier without coercion.
     * @param {object} asset Canonical asset.
     * @returns {string} Asset id when present.
     */
    static #assetId(asset) {
        const descriptor = Scene3dInputPreflight.#descriptor(asset, 'id')
        return typeof descriptor?.value === 'string' ? descriptor.value : ''
    }

    /**
     * Creates a typed preflight byte-limit error.
     * @param {number} actual Actual resident bytes.
     * @param {number} maximum Configured maximum.
     * @param {'asset' | 'total'} scope Limit scope.
     * @param {string} assetId Current asset id.
     * @returns {ToolkitError} Typed limit error.
     */
    static #limit(actual, maximum, scope, assetId) {
        return new ToolkitError('Scene asset bytes exceed the safe limit.', {
            code: 'ERR_ASSET_LIMIT',
            category: 'unsupported',
            details: { assetId, scope, actual, maximum }
        })
    }
}

Object.freeze(Scene3dInputPreflight.prototype)
Object.freeze(Scene3dInputPreflight)
