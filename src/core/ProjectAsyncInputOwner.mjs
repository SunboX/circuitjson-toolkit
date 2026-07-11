import { BinaryDataSnapshot } from './context/BinaryDataSnapshot.mjs'
import { ToolkitAsset } from './contracts/ToolkitAsset.mjs'

/**
 * Owns direct asynchronous project payloads before host callbacks run.
 */
export class ProjectAsyncInputOwner {
    /**
     * Owns candidate bytes and prepares companion assets once.
     * @param {{ entries: object[] }} classified Classified entries.
     * @param {'none' | 'metadata' | 'full'} assetMode Asset decode mode.
     * @returns {void}
     */
    static own(classified, assetMode) {
        const snapshots = new WeakMap()
        for (const entry of classified.entries) {
            if (entry.name.toLowerCase().endsWith('.json')) {
                entry.input.data = ProjectAsyncInputOwner.#binary(
                    entry.input.data,
                    snapshots
                )
                continue
            }
            if (assetMode === 'none') continue
            entry.companionAsset = ProjectAsyncInputOwner.#companionAsset(
                entry,
                assetMode
            )
        }
    }

    /**
     * Copies one binary value once while leaving immutable text unchanged.
     * @param {unknown} value Entry data.
     * @param {WeakMap<object, unknown>} snapshots Request-local binary copies.
     * @returns {unknown} Owned data.
     */
    static #binary(value, snapshots) {
        if (typeof value === 'string') return value
        if (value && typeof value === 'object' && snapshots.has(value)) {
            return snapshots.get(value)
        }
        const owned = BinaryDataSnapshot.clone(value)
        if (value && typeof value === 'object') snapshots.set(value, owned)
        return owned
    }

    /**
     * Prepares one companion asset as the final canonical payload snapshot.
     * @param {object} entry Classified companion entry.
     * @param {'metadata' | 'full'} mode Asset decode mode.
     * @returns {Record<string, any>} Prepared companion asset.
     */
    static #companionAsset(entry, mode) {
        return ToolkitAsset.prepare(
            {
                kind: 'companion',
                name: entry.name,
                mediaType: 'application/octet-stream',
                byteLength: entry.byteLength,
                data: entry.input.data,
                source: { entryName: entry.name }
            },
            { mode }
        )
    }
}

Object.freeze(ProjectAsyncInputOwner.prototype)
Object.freeze(ProjectAsyncInputOwner)
