import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import test from 'node:test'

import { ArchiveLimits } from '../src/core/ArchiveLimits.mjs'
import { ZipArchiveInspector } from '../src/core/ZipArchiveInspector.mjs'

/**
 * Calculates the ZIP CRC32 for one byte range.
 * @param {Uint8Array} bytes Source bytes.
 * @returns {number} Unsigned CRC32.
 */
function crc32(bytes) {
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
        }
    }
    return (crc ^ 0xffffffff) >>> 0
}

/**
 * Builds a small ZIP with caller-selected central and local metadata.
 * @param {{ name: string, localName?: string, data?: number[], declaredSize?: number, flags?: number, method?: 0 | 8, localCrc32?: number, centralCrc32?: number, localCompressedSize?: number, localUncompressedSize?: number }[]} entries ZIP entries.
 * @returns {Uint8Array} ZIP bytes.
 */
function createStoredZip(entries) {
    const encoder = new TextEncoder()
    const locals = []
    const centrals = []
    let localOffset = 0
    for (const entry of entries) {
        const name = encoder.encode(entry.name)
        const localName = encoder.encode(entry.localName || entry.name)
        const data = Uint8Array.from(entry.data || [])
        const method = entry.method || 0
        const compressed =
            method === 8
                ? new Uint8Array(deflateRawSync(data, { level: 0 }))
                : data
        const declaredSize = entry.declaredSize ?? data.byteLength
        const expectedCrc32 = crc32(data)
        const local = new Uint8Array(
            30 + localName.byteLength + compressed.byteLength
        )
        const localView = new DataView(local.buffer)
        localView.setUint32(0, 0x04034b50, true)
        localView.setUint16(4, 20, true)
        localView.setUint16(6, entry.flags || 0, true)
        localView.setUint16(8, method, true)
        localView.setUint32(14, entry.localCrc32 ?? expectedCrc32, true)
        localView.setUint32(
            18,
            entry.localCompressedSize ?? compressed.byteLength,
            true
        )
        localView.setUint32(
            22,
            entry.localUncompressedSize ?? declaredSize,
            true
        )
        localView.setUint16(26, localName.byteLength, true)
        local.set(localName, 30)
        local.set(compressed, 30 + localName.byteLength)
        locals.push(local)

        const central = new Uint8Array(46 + name.byteLength)
        const centralView = new DataView(central.buffer)
        centralView.setUint32(0, 0x02014b50, true)
        centralView.setUint16(4, 20, true)
        centralView.setUint16(6, 20, true)
        centralView.setUint16(8, entry.flags || 0, true)
        centralView.setUint16(10, method, true)
        centralView.setUint32(16, entry.centralCrc32 ?? expectedCrc32, true)
        centralView.setUint32(20, compressed.byteLength, true)
        centralView.setUint32(24, declaredSize, true)
        centralView.setUint16(28, name.byteLength, true)
        centralView.setUint32(42, localOffset, true)
        central.set(name, 46)
        centrals.push(central)
        localOffset += local.byteLength
    }
    const centralSize = centrals.reduce(
        (total, central) => total + central.byteLength,
        0
    )
    const end = new Uint8Array(22)
    const endView = new DataView(end.buffer)
    endView.setUint32(0, 0x06054b50, true)
    endView.setUint16(8, entries.length, true)
    endView.setUint16(10, entries.length, true)
    endView.setUint32(12, centralSize, true)
    endView.setUint32(16, localOffset, true)

    const result = new Uint8Array(localOffset + centralSize + end.byteLength)
    let offset = 0
    for (const part of [...locals, ...centrals, end]) {
        result.set(part, offset)
        offset += part.byteLength
    }
    return result
}

/**
 * Adds a standards-valid ZIP comment without changing member metadata.
 * @param {Uint8Array} archive ZIP bytes.
 * @param {number} length Comment byte length.
 * @returns {Uint8Array} ZIP bytes with a padded comment.
 */
function withZipComment(archive, length) {
    const result = new Uint8Array(archive.byteLength + length)
    result.set(archive)
    new DataView(result.buffer).setUint16(archive.byteLength - 2, length, true)
    return result
}

test('ZipArchiveInspector returns normalized bounded central-directory metadata', () => {
    const archive = createStoredZip([
        { name: './layers/board.gtl', data: [1, 2] },
        { name: 'models/body.step', data: [3, 4, 5] }
    ])
    const report = ZipArchiveInspector.inspect(archive, {
        archiveName: 'neutral.zip',
        limits: ArchiveLimits.normalize({
            maxEntries: 2,
            maxEntryBytes: 3,
            maxTotalBytes: 5,
            maxCompressionRatio: 100,
            maxArchiveDepth: 1
        })
    })

    assert.equal(report.schema, 'ecad-toolkit.zip-preflight.v1')
    assert.equal(report.entryCount, 2)
    assert.equal(report.totalUncompressedBytes, 5)
    assert.deepEqual(
        report.entries.map((entry) => entry.name),
        ['layers/board.gtl', 'models/body.step']
    )
    assert.deepEqual(
        report.entries.map((entry) => entry.crc32),
        [crc32(Uint8Array.from([1, 2])), crc32(Uint8Array.from([3, 4, 5]))]
    )
    assert.equal(
        ZipArchiveInspector.verifyExtractedBytes(
            report.entries[0],
            Uint8Array.from([1, 2])
        ),
        true
    )
    assert.equal(Object.isFrozen(report), true)
    assert.equal(Object.isFrozen(report.entries), true)
})

test('ZipArchiveInspector rejects depth and declared allocation limits before inflation', () => {
    const archive = createStoredZip([
        { name: 'large.gtl', data: [1], declaredSize: 1_000_000 }
    ])

    assert.throws(
        () =>
            ZipArchiveInspector.inspect(archive, {
                limits: ArchiveLimits.normalize({ maxArchiveDepth: 0 })
            }),
        (error) => error?.details?.limit === 'maxArchiveDepth'
    )
    assert.throws(
        () =>
            ZipArchiveInspector.inspect(archive, {
                limits: ArchiveLimits.normalize({ maxEntryBytes: 1 })
            }),
        (error) => error?.details?.limit === 'maxEntryBytes'
    )
    assert.throws(
        () =>
            ZipArchiveInspector.inspect(archive, {
                limits: ArchiveLimits.normalize({ maxCompressionRatio: 2 })
            }),
        (error) => error?.details?.limit === 'maxCompressionRatio'
    )
})

test('ZipArchiveInspector calculates compression ratio from member payload sizes', () => {
    const padded = withZipComment(
        createStoredZip([{ name: 'payload.bin', data: [1, 2, 3, 4] }]),
        1024
    )

    assert.throws(
        () =>
            ZipArchiveInspector.inspect(padded, {
                limits: ArchiveLimits.normalize({ maxCompressionRatio: 0.5 })
            }),
        (error) => error?.details?.limit === 'maxCompressionRatio'
    )

    assert.doesNotThrow(() =>
        ZipArchiveInspector.inspect(
            createStoredZip([{ name: 'empty.bin', data: [] }]),
            {
                limits: ArchiveLimits.normalize({ maxCompressionRatio: 0.5 })
            }
        )
    )
    assert.throws(
        () =>
            ZipArchiveInspector.inspect(
                createStoredZip([
                    { name: 'declared.bin', data: [], declaredSize: 1 }
                ]),
                {
                    limits: ArchiveLimits.normalize({
                        maxCompressionRatio: 1000
                    })
                }
            ),
        (error) => error?.details?.limit === 'maxCompressionRatio'
    )
})

test('ZipArchiveInspector rejects unsafe paths, encryption, and malformed input', () => {
    assert.throws(
        () =>
            ZipArchiveInspector.inspect(
                createStoredZip([{ name: '../escape.gtl', data: [1] }])
            ),
        (error) => error?.code === 'ERR_ARCHIVE_PATH'
    )
    assert.throws(
        () =>
            ZipArchiveInspector.inspect(
                createStoredZip([
                    { name: 'encrypted.gtl', data: [1], flags: 1 }
                ])
            ),
        (error) => error?.code === 'ERR_ARCHIVE_UNSUPPORTED'
    )
    assert.throws(
        () => ZipArchiveInspector.inspect(new Uint8Array([1, 2, 3])),
        (error) => error?.code === 'ERR_ARCHIVE_INVALID'
    )
})

test('ZipArchiveInspector rejects inconsistent local names, sizes, and CRC32 metadata', () => {
    assert.throws(
        () =>
            ZipArchiveInspector.inspect(
                createStoredZip([
                    {
                        name: 'central.gtl',
                        localName: 'different.gtl',
                        data: [1, 2, 3]
                    }
                ])
            ),
        (error) => error?.code === 'ERR_ARCHIVE_INVALID'
    )
    assert.throws(
        () =>
            ZipArchiveInspector.inspect(
                createStoredZip([
                    {
                        name: 'size.gtl',
                        data: [1, 2, 3],
                        localUncompressedSize: 4
                    }
                ])
            ),
        (error) => error?.code === 'ERR_ARCHIVE_INVALID'
    )
    assert.throws(
        () =>
            ZipArchiveInspector.inspect(
                createStoredZip([
                    {
                        name: 'crc.gtl',
                        data: [1, 2, 3],
                        localCrc32: 123
                    }
                ])
            ),
        (error) => error?.code === 'ERR_ARCHIVE_INVALID'
    )
})

test('ZipArchiveInspector detects corrupt stored and deflated extracted bytes', () => {
    for (const method of [0, 8]) {
        const data = Uint8Array.from([10, 20, 30, 40, 50, 60])
        const report = ZipArchiveInspector.inspect(
            createStoredZip([
                { name: `method-${method}.gtl`, data: [...data], method }
            ])
        )
        const corrupt = data.slice()
        corrupt[2] ^= 0xff

        assert.equal(
            ZipArchiveInspector.verifyExtractedBytes(report.entries[0], data),
            true
        )
        assert.throws(
            () =>
                ZipArchiveInspector.verifyExtractedBytes(
                    report.entries[0],
                    corrupt
                ),
            (error) =>
                error?.code === 'ERR_ARCHIVE_INVALID' &&
                error?.details?.expectedCrc32 === report.entries[0].crc32
        )
    }
})
