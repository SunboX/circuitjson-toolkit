/**
 * Replaces metadata roots before a canonical document becomes immutable.
 */
export class CircuitJsonMetadataBoundary {
    /**
     * Normalizes document and asset metadata through one trusted callback.
     * @param {object} document Canonical document envelope.
     * @param {unknown} assets Canonical asset array.
     * @param {(value: unknown) => unknown} normalize Metadata normalizer.
     * @returns {void}
     */
    static normalize(document, assets, normalize) {
        for (const key of ['source', 'extensions']) {
            CircuitJsonMetadataBoundary.#normalizeProperty(
                document,
                key,
                normalize
            )
        }
        if (!Array.isArray(assets)) return
        const length = Object.getOwnPropertyDescriptor(assets, 'length')?.value
        for (let index = 0; index < length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(
                assets,
                String(index)
            )
            const asset = descriptor?.value
            if (asset && typeof asset === 'object') {
                CircuitJsonMetadataBoundary.#normalizeProperty(
                    asset,
                    'source',
                    normalize
                )
            }
        }
    }

    /**
     * Normalizes one own data property and replaces only changed roots.
     * @param {object} owner Property owner.
     * @param {string} key Property key.
     * @param {(value: unknown) => unknown} normalize Metadata normalizer.
     * @returns {void}
     */
    static #normalizeProperty(owner, key, normalize) {
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(owner, key)
        } catch {
            throw new TypeError(
                'Canonical metadata could not be inspected safely.'
            )
        }
        if (!descriptor) return
        if (!Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(
                'Canonical metadata must be stored in own data properties.'
            )
        }
        const normalized = normalize(descriptor.value)
        if (normalized === descriptor.value) return
        try {
            Object.defineProperty(owner, key, {
                ...descriptor,
                value: normalized
            })
        } catch {
            throw new TypeError(
                'Canonical metadata could not be normalized safely.'
            )
        }
    }
}

Object.freeze(CircuitJsonMetadataBoundary.prototype)
Object.freeze(CircuitJsonMetadataBoundary)
