import { ToolkitError } from './contracts/ToolkitError.mjs'

const DRIVE_PATH = /^[A-Za-z]:/u

/**
 * Normalizes untrusted archive entry names without touching the host filesystem.
 */
export class ArchiveEntryPath {
    /**
     * Normalizes one entry name to a safe relative POSIX path.
     * @param {unknown} name Archive entry name.
     * @returns {string} Safe normalized entry name.
     */
    static normalize(name) {
        if (typeof name !== 'string' || !name || name.includes('\0')) {
            throw ArchiveEntryPath.#pathError(name)
        }

        const candidate = name.replaceAll('\\', '/')
        if (candidate.startsWith('/') || DRIVE_PATH.test(candidate)) {
            throw ArchiveEntryPath.#pathError(name)
        }

        const segments = []
        for (const segment of candidate.split('/')) {
            if (!segment || segment === '.') continue
            if (segment === '..') {
                if (!segments.length) {
                    throw ArchiveEntryPath.#pathError(name)
                }
                segments.pop()
                continue
            }
            segments.push(segment)
        }

        if (!segments.length) throw ArchiveEntryPath.#pathError(name)
        return segments.join('/')
    }

    /**
     * Normalizes entry names and rejects collisions after normalization.
     * @param {unknown} names Archive entry names.
     * @returns {string[]} Normalized names in caller order.
     */
    static unique(names) {
        if (!Array.isArray(names)) {
            throw new ToolkitError('Archive entry names must be an array.', {
                code: 'ERR_ARCHIVE_PATH',
                category: 'validation',
                format: 'archive'
            })
        }

        const normalized = []
        const seen = new Set()
        for (const name of names) {
            const entryName = ArchiveEntryPath.normalize(name)
            if (seen.has(entryName)) {
                throw new ToolkitError(
                    `Duplicate normalized archive entry: ${entryName}.`,
                    {
                        code: 'ERR_ARCHIVE_DUPLICATE_ENTRY',
                        category: 'validation',
                        format: 'archive',
                        source: entryName,
                        details: { entryName }
                    }
                )
            }
            seen.add(entryName)
            normalized.push(entryName)
        }
        return normalized
    }

    /**
     * Creates one unsafe-entry error without reflecting NUL data into messages.
     * @param {unknown} name Rejected entry name.
     * @returns {ToolkitError} Typed path error.
     */
    static #pathError(name) {
        const source =
            typeof name === 'string' && !name.includes('\0') ? name : ''
        return new ToolkitError('Archive entry path is unsafe.', {
            code: 'ERR_ARCHIVE_PATH',
            category: 'validation',
            format: 'archive',
            source,
            details: { reason: 'unsafe-relative-path' }
        })
    }
}
