import { ToolkitAsset } from '../contracts/ToolkitAsset.mjs'
import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { CircuitJsonReadOnlyDocument } from '../context/CircuitJsonReadOnlyDocument.mjs'
import { Scene3dModelReference } from './Scene3dModelReference.mjs'
import { Scene3dOptions } from './Scene3dOptions.mjs'

/**
 * Selects bounded scene assets through exact canonical path aliases.
 */
export class Scene3dAssetIndex {
    #byAlias
    #byAsset
    #byReference
    #claims
    #options
    #selected
    #totalBytes

    /**
     * Creates one request-local asset index without copying payload bytes.
     * @param {unknown} values Canonical document assets.
     * @param {ReturnType<Scene3dOptions['normalize']>} options Scene options.
     */
    constructor(values, options) {
        const assets = Scene3dOptions.dataArray(
            values === undefined ? [] : values,
            'Scene assets',
            Scene3dOptions.maxAssetCount
        )
        this.#options = options
        this.#byAlias = new Map()
        this.#byAsset = new WeakMap()
        this.#byReference = new Map()
        this.#claims = new Map()
        this.#selected = []
        this.#totalBytes = 0
        const ids = new Map()
        const metadataBudget =
            CircuitJsonReadOnlyDocument.createMetadataBudget()
        for (const asset of assets) {
            const metadata = Scene3dAssetIndex.#lookupMetadata(
                CircuitJsonReadOnlyDocument.copyAssetIndexFields(
                    asset,
                    metadataBudget
                )
            )
            if (
                metadata.id &&
                ids.has(metadata.id) &&
                ids.get(metadata.id) !== asset
            ) {
                throw Scene3dAssetIndex.#ambiguousId(metadata.id)
            }
            if (metadata.id) ids.set(metadata.id, asset)
            const entry = { asset, metadata }
            for (const alias of Scene3dAssetIndex.#aliases(metadata)) {
                if (!this.#byAlias.has(alias)) {
                    this.#byAlias.set(alias, entry)
                } else if (this.#byAlias.get(alias)?.asset !== asset) {
                    this.#byAlias.set(alias, null)
                }
            }
        }
    }

    /**
     * Returns selected assets in deterministic first-reference order.
     * @returns {object[]} Canonical scene assets.
     */
    get assets() {
        return [...this.#selected]
    }

    /**
     * Resolves one exact model reference or creates an unresolved request.
     * @param {{ name: string, mediaType: string }} reference Model reference.
     * @returns {object} Canonical scene asset.
     */
    resolve(reference) {
        const wanted = Scene3dModelReference.normalizedPath(reference.name)
        if (this.#byReference.has(wanted)) {
            return this.#byReference.get(wanted)
        }
        const entry = this.#byAlias.get(wanted)
        if (entry === null) {
            throw new ToolkitError(
                `Scene asset reference is ambiguous: ${reference.name}.`,
                {
                    code: 'ERR_ASSET_AMBIGUOUS',
                    category: 'unsupported',
                    source: reference.name,
                    details: { name: reference.name }
                }
            )
        }
        const asset = entry
            ? this.#materialize(entry)
            : ToolkitAsset.create({
                  kind: 'model3d',
                  name: reference.name,
                  mediaType: reference.mediaType,
                  data: null,
                  source: { uri: reference.name }
              })
        const identity = entry?.asset || `unresolved:${wanted}`
        this.#claim(asset, identity)
        this.#byReference.set(wanted, asset)
        return asset
    }

    /**
     * Copies one matched payload only after both byte limits pass.
     * @param {{ asset: object, metadata: object }} entry Indexed asset entry.
     * @returns {object} Canonical copied asset.
     */
    #materialize(entry) {
        const cached = this.#byAsset.get(entry.asset)
        if (cached) return cached
        const bytes = CircuitJsonReadOnlyDocument.assetPayloadByteLength(
            entry.asset
        )
        if (bytes > this.#options.maxAssetBytes) {
            throw Scene3dAssetIndex.#limitError(
                entry.metadata,
                bytes,
                this.#options.maxAssetBytes,
                'asset'
            )
        }
        if (this.#totalBytes + bytes > this.#options.maxTotalAssetBytes) {
            throw Scene3dAssetIndex.#limitError(
                entry.metadata,
                this.#totalBytes + bytes,
                this.#options.maxTotalAssetBytes,
                'total'
            )
        }
        const result = ToolkitAsset.create(
            CircuitJsonReadOnlyDocument.copyAssetFields(entry.asset)
        )
        this.#totalBytes += bytes
        this.#byAsset.set(entry.asset, result)
        return result
    }

    /**
     * Adds a unique selected asset and rejects deterministic-id collisions.
     * @param {object} asset Canonical scene asset.
     * @param {object | string} identity Source identity.
     * @returns {void}
     */
    #claim(asset, identity) {
        if (this.#claims.has(asset.id)) {
            if (this.#claims.get(asset.id) !== identity) {
                throw Scene3dAssetIndex.#ambiguousId(asset.id)
            }
            return
        }
        if (this.#selected.length >= Scene3dOptions.maxAssetCount) {
            throw new ToolkitError(
                'Scene asset count exceeds the safe limit.',
                {
                    code: 'ERR_ASSET_LIMIT',
                    category: 'unsupported',
                    details: {
                        count: this.#selected.length + 1,
                        maximum: Scene3dOptions.maxAssetCount
                    }
                }
            )
        }
        this.#claims.set(asset.id, identity)
        this.#selected.push(asset)
    }

    /**
     * Builds exact normalized aliases without basename guessing.
     * @param {object} asset Canonical asset metadata.
     * @returns {Set<string>} Alias set.
     */
    static #aliases(asset) {
        return new Set(
            [
                asset.name,
                asset.source.entryName,
                asset.source.projectRelativePath,
                asset.source.project_relative_path,
                asset.source.relativePath,
                asset.source.url,
                asset.source.uri
            ]
                .map((value) => Scene3dModelReference.normalizedPath(value))
                .filter(Boolean)
        )
    }

    /**
     * Retains only scalar identity and exact path aliases for eager indexing.
     * @param {Record<string, any>} fields Descriptor-safe asset fields.
     * @returns {{ id: string, name: string, source: Record<string, string> }} Lightweight lookup metadata.
     */
    static #lookupMetadata(fields) {
        const source = Object.create(null)
        const candidate = fields.source
        if (candidate && typeof candidate === 'object') {
            for (const key of [
                'entryName',
                'projectRelativePath',
                'project_relative_path',
                'relativePath',
                'url',
                'uri'
            ]) {
                let descriptor
                try {
                    descriptor = Object.getOwnPropertyDescriptor(candidate, key)
                } catch {
                    throw new TypeError(
                        'Canonical asset source aliases could not be inspected safely.'
                    )
                }
                if (!descriptor) continue
                if (!Object.hasOwn(descriptor, 'value')) {
                    throw new TypeError(
                        'Canonical asset source aliases must be data properties.'
                    )
                }
                source[key] = Scene3dAssetIndex.#scalarText(
                    descriptor.value,
                    ''
                )
            }
        }
        return {
            id: Scene3dAssetIndex.#scalarText(fields.id, ''),
            name: Scene3dAssetIndex.#scalarText(fields.name, ''),
            source
        }
    }

    /**
     * Converts an already validated primitive without object coercion.
     * @param {unknown} value Primitive candidate.
     * @param {string} fallback Fallback string.
     * @returns {string} Primitive text.
     */
    static #scalarText(value, fallback) {
        if (!value) return fallback
        if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value)) {
            return fallback
        }
        return String(value)
    }

    /**
     * Creates an asset-id ambiguity failure.
     * @param {string} assetId Colliding canonical id.
     * @returns {ToolkitError} Typed failure.
     */
    static #ambiguousId(assetId) {
        return new ToolkitError(`Scene asset id is ambiguous: ${assetId}.`, {
            code: 'ERR_ASSET_AMBIGUOUS',
            category: 'unsupported',
            details: { assetId }
        })
    }

    /**
     * Creates a synchronous asset-size failure.
     * @param {object} asset Canonical asset metadata.
     * @param {number} actual Selected bytes.
     * @param {number} maximum Configured byte maximum.
     * @param {'asset' | 'total'} scope Limit scope.
     * @returns {ToolkitError} Typed failure.
     */
    static #limitError(asset, actual, maximum, scope) {
        return new ToolkitError('Scene asset bytes exceed the safe limit.', {
            code: 'ERR_ASSET_LIMIT',
            category: 'unsupported',
            source: asset.name,
            details: { assetId: asset.id, scope, actual, maximum }
        })
    }
}
