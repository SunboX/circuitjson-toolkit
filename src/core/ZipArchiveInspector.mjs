import { ArchiveEntryPath } from './ArchiveEntryPath.mjs'
import { ArchiveLimits } from './ArchiveLimits.mjs'
import { BinaryDataSnapshot } from './context/BinaryDataSnapshot.mjs'
import { ToolkitError } from './contracts/ToolkitError.mjs'

const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const LOCAL_SIGNATURE = 0x04034b50
const END_FIXED_BYTES = 22
const CENTRAL_FIXED_BYTES = 46
const LOCAL_FIXED_BYTES = 30
const MAX_END_SEARCH_BYTES = 65_557
const ZIP64_UINT16 = 0xffff
const ZIP64_UINT32 = 0xffffffff
const DATA_DESCRIPTOR_FLAG = 0x0008
const TEXT_DECODER = new TextDecoder()
const TEXT_DECODER_DECODE = TextDecoder.prototype.decode
const CRC32_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
    }
    CRC32_TABLE[index] = value >>> 0
}

/** Inspects ZIP central-directory metadata before any payload is inflated. */
export class ZipArchiveInspector {
    /**
     * Validates archive metadata against normalized shared limits.
     * @param {ArrayBuffer | Uint8Array | DataView} data ZIP bytes.
     * @param {{ archiveName?: string, archiveDepth?: number, baseEntryCount?: number, baseTotalBytes?: number, limits?: Record<string, number> }} [options] Inspection options.
     * @returns {{ schema: string, archiveName: string, archiveDepth: number, entryCount: number, totalCompressedBytes: number, totalUncompressedBytes: number, entries: ReadonlyArray<Readonly<Record<string, any>>> }} Frozen preflight report.
     */
    static inspect(data, options = {}) {
        const normalized = ZipArchiveInspector.#options(options)
        const bytes = ZipArchiveInspector.#bytes(data)
        ZipArchiveInspector.#assertLimit(
            'maxArchiveDepth',
            normalized.limits.maxArchiveDepth,
            normalized.archiveDepth,
            normalized.archiveName
        )
        const end = ZipArchiveInspector.#endRecord(bytes)
        const view = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength
        )
        const entries = ZipArchiveInspector.#centralEntries(
            bytes,
            view,
            end,
            normalized
        )
        const totalCompressedBytes = entries.reduce(
            (total, entry) => total + entry.compressedSize,
            0
        )
        const totalUncompressedBytes = entries.reduce(
            (total, entry) => total + entry.uncompressedSize,
            0
        )
        ZipArchiveInspector.#assertLimit(
            'maxEntries',
            normalized.limits.maxEntries,
            normalized.baseEntryCount + entries.length,
            normalized.archiveName
        )
        ZipArchiveInspector.#assertLimit(
            'maxTotalBytes',
            normalized.limits.maxTotalBytes,
            normalized.baseTotalBytes + totalUncompressedBytes,
            normalized.archiveName
        )
        const ratio =
            totalCompressedBytes === 0
                ? totalUncompressedBytes === 0
                    ? 0
                    : Number.POSITIVE_INFINITY
                : totalUncompressedBytes / totalCompressedBytes
        ZipArchiveInspector.#assertLimit(
            'maxCompressionRatio',
            normalized.limits.maxCompressionRatio,
            ratio,
            normalized.archiveName
        )
        const uniqueNames = ArchiveEntryPath.unique(
            entries
                .filter((entry) => !entry.directory)
                .map((entry) => entry.name)
        )
        let fileIndex = 0
        const frozenEntries = entries.map((entry) =>
            Object.freeze({
                ...entry,
                name: entry.directory ? entry.name : uniqueNames[fileIndex++]
            })
        )
        return Object.freeze({
            schema: 'ecad-toolkit.zip-preflight.v1',
            archiveName: normalized.archiveName,
            archiveDepth: normalized.archiveDepth,
            entryCount: entries.length,
            totalCompressedBytes,
            totalUncompressedBytes,
            entries: Object.freeze(frozenEntries)
        })
    }

    /**
     * Verifies bytes produced by an inflater against inspected ZIP metadata.
     * @param {{ name: string, uncompressedSize: number, crc32: number }} entry Frozen entry from `inspect()`.
     * @param {ArrayBuffer | Uint8Array | DataView} data Extracted entry bytes.
     * @returns {true} True when size and CRC32 match.
     */
    static verifyExtractedBytes(entry, data) {
        const expected = ZipArchiveInspector.#integrityEntry(entry)
        const bytes = ZipArchiveInspector.#bytes(data)
        if (bytes.byteLength !== expected.uncompressedSize) {
            throw ZipArchiveInspector.#integrityInvalid(
                'ZIP extracted byte length differs from its central directory.',
                expected,
                { actualSize: bytes.byteLength }
            )
        }
        const actualCrc32 = ZipArchiveInspector.#crc32(bytes)
        if (actualCrc32 !== expected.crc32) {
            throw ZipArchiveInspector.#integrityInvalid(
                'ZIP extracted bytes fail CRC32 verification.',
                expected,
                { actualCrc32 }
            )
        }
        return true
    }

    /**
     * Reads and validates every central-directory record.
     * @param {Uint8Array} bytes Archive bytes.
     * @param {DataView} view Archive view.
     * @param {{ entryCount: number, centralOffset: number, centralSize: number, offset: number }} end End record.
     * @param {Record<string, any>} options Normalized options.
     * @returns {Record<string, any>[]} Entry metadata.
     */
    static #centralEntries(bytes, view, end, options) {
        ZipArchiveInspector.#assertLimit(
            'maxEntries',
            options.limits.maxEntries,
            options.baseEntryCount + end.entryCount,
            options.archiveName
        )
        const centralEnd = end.centralOffset + end.centralSize
        if (
            end.centralOffset < 0 ||
            end.centralSize < 0 ||
            centralEnd > end.offset ||
            centralEnd > bytes.byteLength
        ) {
            throw ZipArchiveInspector.#invalid(
                'ZIP central directory points outside the archive.',
                options.archiveName
            )
        }
        const entries = []
        let offset = end.centralOffset
        for (let index = 0; index < end.entryCount; index += 1) {
            if (
                offset + CENTRAL_FIXED_BYTES > centralEnd ||
                view.getUint32(offset, true) !== CENTRAL_SIGNATURE
            ) {
                throw ZipArchiveInspector.#invalid(
                    'ZIP central directory entry is malformed.',
                    options.archiveName
                )
            }
            const flags = view.getUint16(offset + 8, true)
            const method = view.getUint16(offset + 10, true)
            const crc32 = view.getUint32(offset + 16, true)
            const compressedSize = view.getUint32(offset + 20, true)
            const uncompressedSize = view.getUint32(offset + 24, true)
            const nameLength = view.getUint16(offset + 28, true)
            const extraLength = view.getUint16(offset + 30, true)
            const commentLength = view.getUint16(offset + 32, true)
            const diskStart = view.getUint16(offset + 34, true)
            const localOffset = view.getUint32(offset + 42, true)
            if (
                compressedSize === ZIP64_UINT32 ||
                uncompressedSize === ZIP64_UINT32 ||
                localOffset === ZIP64_UINT32 ||
                diskStart === ZIP64_UINT16
            ) {
                throw ZipArchiveInspector.#unsupported(
                    'ZIP64 archives are not supported by this bounded loader.',
                    options.archiveName
                )
            }
            if (diskStart !== 0) {
                throw ZipArchiveInspector.#unsupported(
                    'Multi-disk ZIP archives are not supported.',
                    options.archiveName
                )
            }
            if ((flags & 1) !== 0) {
                throw ZipArchiveInspector.#unsupported(
                    'Encrypted ZIP entries are not supported.',
                    options.archiveName
                )
            }
            if (![0, 8].includes(method)) {
                throw ZipArchiveInspector.#unsupported(
                    `ZIP compression method ${method} is not supported.`,
                    options.archiveName
                )
            }
            const recordEnd =
                offset +
                CENTRAL_FIXED_BYTES +
                nameLength +
                extraLength +
                commentLength
            if (recordEnd > centralEnd) {
                throw ZipArchiveInspector.#invalid(
                    'ZIP central directory entry exceeds its directory.',
                    options.archiveName
                )
            }
            const rawNameBytes = bytes.subarray(
                offset + CENTRAL_FIXED_BYTES,
                offset + CENTRAL_FIXED_BYTES + nameLength
            )
            const rawName = Reflect.apply(TEXT_DECODER_DECODE, TEXT_DECODER, [
                rawNameBytes
            ])
            const directory = rawName.endsWith('/')
            const path = directory ? rawName.slice(0, -1) : rawName
            const name = ArchiveEntryPath.normalize(path)
            ZipArchiveInspector.#assertLimit(
                'maxEntryBytes',
                options.limits.maxEntryBytes,
                uncompressedSize,
                name
            )
            const payloadOffset = ZipArchiveInspector.#localRecord(
                bytes,
                view,
                end.centralOffset,
                localOffset,
                rawNameBytes,
                compressedSize,
                uncompressedSize,
                crc32,
                flags,
                method,
                options.archiveName
            )
            entries.push({
                name,
                directory,
                flags,
                method,
                crc32,
                compressedSize,
                uncompressedSize,
                localOffset,
                payloadOffset
            })
            offset = recordEnd
        }
        if (offset !== centralEnd) {
            throw ZipArchiveInspector.#invalid(
                'ZIP central directory size is inconsistent.',
                options.archiveName
            )
        }
        return entries
    }

    /**
     * Validates the local record and compressed payload window.
     * @param {Uint8Array} bytes Archive bytes.
     * @param {DataView} view Archive view.
     * @param {number} centralOffset Central-directory offset.
     * @param {number} offset Local record offset.
     * @param {Uint8Array} centralNameBytes Central-directory filename bytes.
     * @param {number} compressedSize Compressed payload bytes.
     * @param {number} uncompressedSize Extracted payload bytes.
     * @param {number} crc32 Expected payload CRC32.
     * @param {number} flags Central flags.
     * @param {number} method Central compression method.
     * @param {string} source Archive name.
     * @returns {number} Compressed payload offset.
     */
    static #localRecord(
        bytes,
        view,
        centralOffset,
        offset,
        centralNameBytes,
        compressedSize,
        uncompressedSize,
        crc32,
        flags,
        method,
        source
    ) {
        if (
            offset + LOCAL_FIXED_BYTES > centralOffset ||
            view.getUint32(offset, true) !== LOCAL_SIGNATURE
        ) {
            throw ZipArchiveInspector.#invalid(
                'ZIP local entry is malformed.',
                source
            )
        }
        const localFlags = view.getUint16(offset + 6, true)
        const localMethod = view.getUint16(offset + 8, true)
        const localCrc32 = view.getUint32(offset + 14, true)
        const localCompressedSize = view.getUint32(offset + 18, true)
        const localUncompressedSize = view.getUint32(offset + 22, true)
        const nameLength = view.getUint16(offset + 26, true)
        const extraLength = view.getUint16(offset + 28, true)
        const nameOffset = offset + LOCAL_FIXED_BYTES
        const payloadOffset = nameOffset + nameLength + extraLength
        let localNameMatches = nameLength === centralNameBytes.byteLength
        for (
            let index = 0;
            localNameMatches && index < nameLength;
            index += 1
        ) {
            localNameMatches =
                bytes[nameOffset + index] === centralNameBytes[index]
        }
        const usesDataDescriptor = (flags & DATA_DESCRIPTOR_FLAG) !== 0
        const descriptorMetadataValid =
            usesDataDescriptor &&
            [
                [localCrc32, crc32],
                [localCompressedSize, compressedSize],
                [localUncompressedSize, uncompressedSize]
            ].every(([local, central]) => local === 0 || local === central)
        const fixedMetadataValid =
            !usesDataDescriptor &&
            localCrc32 === crc32 &&
            localCompressedSize === compressedSize &&
            localUncompressedSize === uncompressedSize
        if (
            localFlags !== flags ||
            localMethod !== method ||
            !localNameMatches ||
            (!descriptorMetadataValid && !fixedMetadataValid) ||
            payloadOffset + compressedSize > centralOffset
        ) {
            throw ZipArchiveInspector.#invalid(
                'ZIP local entry metadata is inconsistent.',
                source
            )
        }
        return payloadOffset
    }

    /**
     * Captures trusted integrity fields without invoking accessors.
     * @param {unknown} entry Inspected entry candidate.
     * @returns {{ name: string, uncompressedSize: number, crc32: number }}
     */
    static #integrityEntry(entry) {
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(entry)
            descriptors = Object.getOwnPropertyDescriptors(entry)
        } catch {
            throw ZipArchiveInspector.#invalid(
                'ZIP integrity metadata must be a plain object.'
            )
        }
        if (
            (prototype !== Object.prototype && prototype !== null) ||
            Object.values(descriptors).some(
                (descriptor) => !Object.hasOwn(descriptor, 'value')
            )
        ) {
            throw ZipArchiveInspector.#invalid(
                'ZIP integrity metadata must contain plain data properties.'
            )
        }
        const name = descriptors.name?.value
        const uncompressedSize = descriptors.uncompressedSize?.value
        const crc32 = descriptors.crc32?.value
        if (
            typeof name !== 'string' ||
            !Number.isSafeInteger(uncompressedSize) ||
            uncompressedSize < 0 ||
            !Number.isInteger(crc32) ||
            crc32 < 0 ||
            crc32 > ZIP64_UINT32
        ) {
            throw ZipArchiveInspector.#invalid(
                'ZIP integrity metadata is incomplete or invalid.'
            )
        }
        return { name, uncompressedSize, crc32 }
    }

    /**
     * Calculates an unsigned CRC32 with one reusable lookup table.
     * @param {Uint8Array} bytes Source bytes.
     * @returns {number} Unsigned CRC32.
     */
    static #crc32(bytes) {
        let crc = 0xffffffff
        for (let index = 0; index < bytes.byteLength; index += 1) {
            crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
        }
        return (crc ^ 0xffffffff) >>> 0
    }

    /**
     * Locates and validates the single-disk end record.
     * @param {Uint8Array} bytes Archive bytes.
     * @returns {{ entryCount: number, centralOffset: number, centralSize: number, offset: number }} End record.
     */
    static #endRecord(bytes) {
        if (bytes.byteLength < END_FIXED_BYTES) {
            throw ZipArchiveInspector.#invalid('ZIP archive is truncated.')
        }
        const view = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength
        )
        const start = Math.max(0, bytes.byteLength - MAX_END_SEARCH_BYTES)
        for (
            let offset = bytes.byteLength - END_FIXED_BYTES;
            offset >= start;
            offset -= 1
        ) {
            if (view.getUint32(offset, true) !== END_SIGNATURE) continue
            const commentLength = view.getUint16(offset + 20, true)
            if (offset + END_FIXED_BYTES + commentLength !== bytes.byteLength) {
                continue
            }
            const disk = view.getUint16(offset + 4, true)
            const centralDisk = view.getUint16(offset + 6, true)
            const diskEntries = view.getUint16(offset + 8, true)
            const entryCount = view.getUint16(offset + 10, true)
            const centralSize = view.getUint32(offset + 12, true)
            const centralOffset = view.getUint32(offset + 16, true)
            if (
                disk === ZIP64_UINT16 ||
                centralDisk === ZIP64_UINT16 ||
                entryCount === ZIP64_UINT16 ||
                centralSize === ZIP64_UINT32 ||
                centralOffset === ZIP64_UINT32
            ) {
                throw ZipArchiveInspector.#unsupported(
                    'ZIP64 archives are not supported by this bounded loader.'
                )
            }
            if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
                throw ZipArchiveInspector.#unsupported(
                    'Multi-disk ZIP archives are not supported.'
                )
            }
            return { entryCount, centralOffset, centralSize, offset }
        }
        throw ZipArchiveInspector.#invalid(
            'ZIP end-of-central-directory record was not found.'
        )
    }

    /**
     * Returns an exact byte view, copying shared memory to prevent races.
     * @param {unknown} data Binary archive data.
     * @returns {Uint8Array} Archive bytes.
     */
    static #bytes(data) {
        const range = BinaryDataSnapshot.describe(data)
        if (!range) {
            throw ZipArchiveInspector.#invalid(
                'ZIP archive data must be binary.'
            )
        }
        if (
            typeof SharedArrayBuffer === 'function' &&
            range.buffer instanceof SharedArrayBuffer
        ) {
            return BinaryDataSnapshot.copyBytes(data, range)
        }
        try {
            return new Uint8Array(
                range.buffer,
                range.byteOffset,
                range.byteLength
            )
        } catch {
            throw ZipArchiveInspector.#invalid(
                'ZIP archive data changed during inspection.'
            )
        }
    }

    /**
     * Captures plain inspection options.
     * @param {unknown} options Options candidate.
     * @returns {Record<string, any>} Normalized options.
     */
    static #options(options) {
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(options)
            descriptors = Object.getOwnPropertyDescriptors(options)
        } catch {
            throw ZipArchiveInspector.#invalid(
                'ZIP inspection options must be a plain object.'
            )
        }
        if (
            (prototype !== Object.prototype && prototype !== null) ||
            Object.values(descriptors).some(
                (descriptor) => !Object.hasOwn(descriptor, 'value')
            )
        ) {
            throw ZipArchiveInspector.#invalid(
                'ZIP inspection options must contain plain data properties.'
            )
        }
        const known = new Set([
            'archiveName',
            'archiveDepth',
            'baseEntryCount',
            'baseTotalBytes',
            'limits'
        ])
        if (Object.keys(descriptors).some((key) => !known.has(key))) {
            throw ZipArchiveInspector.#invalid(
                'ZIP inspection options contain an unknown field.'
            )
        }
        return {
            archiveName: ZipArchiveInspector.#string(
                descriptors.archiveName?.value,
                ''
            ),
            archiveDepth: ZipArchiveInspector.#integer(
                descriptors.archiveDepth?.value,
                1,
                'archiveDepth'
            ),
            baseEntryCount: ZipArchiveInspector.#integer(
                descriptors.baseEntryCount?.value,
                0,
                'baseEntryCount'
            ),
            baseTotalBytes: ZipArchiveInspector.#integer(
                descriptors.baseTotalBytes?.value,
                0,
                'baseTotalBytes'
            ),
            limits: ArchiveLimits.normalize(descriptors.limits?.value || {})
        }
    }

    /** @param {unknown} value Value. @param {string} fallback Fallback. @returns {string} String. */
    static #string(value, fallback) {
        if (value === undefined) return fallback
        if (typeof value !== 'string') {
            throw ZipArchiveInspector.#invalid(
                'ZIP archiveName must be a string.'
            )
        }
        return value
    }

    /** @param {unknown} value Value. @param {number} fallback Fallback. @param {string} name Field name. @returns {number} Integer. */
    static #integer(value, fallback, name) {
        if (value === undefined) return fallback
        if (!Number.isSafeInteger(value) || value < 0) {
            throw ZipArchiveInspector.#invalid(
                `ZIP ${name} must be a nonnegative safe integer.`
            )
        }
        return value
    }

    /** @param {string} name Limit name. @param {number} limit Limit. @param {number} actual Actual. @param {string} source Source. @returns {void} */
    static #assertLimit(name, limit, actual, source) {
        if (actual <= limit) return
        throw new ToolkitError(`Archive ${name} exceeded.`, {
            code: 'ERR_ARCHIVE_LIMIT_EXCEEDED',
            category: 'validation',
            format: 'archive',
            source,
            details: {
                limit: name,
                maximum: limit,
                actual,
                entryName: source
            }
        })
    }

    /** @param {string} message Message. @param {string} [source] Source. @returns {ToolkitError} Error. */
    static #invalid(message, source = '') {
        return new ToolkitError(message, {
            code: 'ERR_ARCHIVE_INVALID',
            category: 'validation',
            format: 'archive',
            source
        })
    }

    /**
     * Builds an archive-integrity error with exact expected and actual fields.
     * @param {string} message Error message.
     * @param {{ name: string, uncompressedSize: number, crc32: number }} expected Expected entry metadata.
     * @param {Record<string, number>} actual Actual integrity fields.
     * @returns {ToolkitError}
     */
    static #integrityInvalid(message, expected, actual) {
        return new ToolkitError(message, {
            code: 'ERR_ARCHIVE_INVALID',
            category: 'validation',
            format: 'archive',
            source: expected.name,
            details: {
                entryName: expected.name,
                expectedSize: expected.uncompressedSize,
                expectedCrc32: expected.crc32,
                ...actual
            }
        })
    }

    /** @param {string} message Message. @param {string} [source] Source. @returns {ToolkitError} Error. */
    static #unsupported(message, source = '') {
        return new ToolkitError(message, {
            code: 'ERR_ARCHIVE_UNSUPPORTED',
            category: 'unsupported',
            format: 'archive',
            source
        })
    }
}

Object.freeze(ZipArchiveInspector.prototype)
Object.freeze(ZipArchiveInspector)
