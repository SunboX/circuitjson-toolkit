import { ArchiveLimitsValidator } from './ArchiveLimitsValidator.mjs'

const DEFAULTS = Object.freeze({
    maxEntries: 4096,
    maxEntryBytes: 536870912,
    maxTotalBytes: 2147483648,
    maxCompressionRatio: 1000,
    maxArchiveDepth: 1
})

/**
 * Publishes the shared non-disableable archive safety ceilings.
 */
export class ArchiveLimits {
    /**
     * Returns the immutable default ceilings.
     * @returns {Readonly<Record<string, number>>} Default archive limits.
     */
    static get defaults() {
        return DEFAULTS
    }

    /**
     * Applies caller overrides that may only tighten the hard ceilings.
     * @param {unknown} [overrides] Caller limit overrides.
     * @returns {Readonly<Record<string, number>>} Normalized archive limits.
     */
    static normalize(overrides = {}) {
        return ArchiveLimitsValidator.normalize(overrides, DEFAULTS)
    }
}
