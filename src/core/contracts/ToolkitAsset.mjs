import { cloneSafeValue } from './ToolkitDiagnostic.mjs'

/**
 * Normalizes embedded and external asset records.
 */
export class ToolkitAsset {
    /**
     * Creates one clone-safe asset record.
     * @param {Record<string, any>} [fields] Asset fields.
     * @returns {{ id: string, kind: string, name: string, mediaType: string, byteLength: number, data: any, source: any }} Normalized asset.
     */
    static create(fields = {}) {
        const data = ToolkitAsset.#copyData(fields.data)
        const kind = String(fields.kind || 'asset')
        const name = String(fields.name || '')
        return {
            id: String(
                fields.id || ToolkitAsset.#id(kind, name, fields.source)
            ),
            kind,
            name,
            mediaType: String(fields.mediaType || 'application/octet-stream'),
            byteLength: ToolkitAsset.#byteLength(data, fields.byteLength),
            data,
            source: cloneSafeValue(fields.source, null)
        }
    }

    /**
     * Copies supported binary or textual asset data.
     * @param {unknown} data Asset payload.
     * @returns {any} Copied clone-safe payload.
     */
    static #copyData(data) {
        if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
        if (ArrayBuffer.isView(data)) {
            const bytes = new Uint8Array(
                data.buffer,
                data.byteOffset,
                data.byteLength
            )
            return new Uint8Array(bytes)
        }
        return typeof data === 'string' ? data : null
    }

    /**
     * Measures one normalized asset payload.
     * @param {unknown} data Asset payload.
     * @param {unknown} declaredByteLength Declared metadata byte length.
     * @returns {number} Byte length.
     */
    static #byteLength(data, declaredByteLength) {
        if (data instanceof ArrayBuffer) return data.byteLength
        if (ArrayBuffer.isView(data)) return data.byteLength
        if (typeof data === 'string')
            return new TextEncoder().encode(data).length
        const declared = Number(declaredByteLength)
        if (Number.isFinite(declared) && declared >= 0) return declared
        return 0
    }

    /**
     * Creates a deterministic source-identity asset id.
     * @param {string} kind Asset kind.
     * @param {string} name Asset name.
     * @param {unknown} source Source reference.
     * @returns {string} Stable id.
     */
    static #id(kind, name, source) {
        const sourceText = JSON.stringify(cloneSafeValue(source, null))
        let hash = 2166136261
        for (const character of `${kind}\u0000${name}\u0000${sourceText}`) {
            hash ^= character.codePointAt(0)
            hash = Math.imul(hash, 16777619)
        }
        return `asset-${(hash >>> 0).toString(16).padStart(8, '0')}`
    }
}
