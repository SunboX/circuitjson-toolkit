import assert from 'node:assert/strict'
import test from 'node:test'

import { ArchiveEntryPath } from '../src/core/ArchiveEntryPath.mjs'
import { ArchiveLimits } from '../src/core/ArchiveLimits.mjs'
import { ProjectLoader } from '../src/core/ProjectLoader.mjs'

test('ProjectLoader returns deterministic partial successes without duplicating document data', () => {
    const result = ProjectLoader.load([
        { name: './z.json', data: '[]' },
        { name: 'broken.json', data: '{' },
        { name: 'nested/../a.json', data: '[]' },
        { name: 'notes.txt', data: 'not CircuitJSON' }
    ])

    assert.equal(result.schema, 'ecad-toolkit.project.v1')
    assert.deepEqual(result.source, {
        format: 'circuitjson',
        entryNames: ['z.json', 'broken.json', 'a.json', 'notes.txt']
    })
    assert.deepEqual(
        result.documents.map((document) => document.source.fileName),
        ['a.json', 'z.json']
    )
    assert.equal(result.project, null)
    assert.deepEqual(result.extensions, {})
    assert.deepEqual(result.assets, [])
    assert.equal(result.diagnostics.length, 1)
    assert.equal(result.diagnostics[0].severity, 'error')
    assert.equal(result.diagnostics[0].code, 'ERR_CIRCUITJSON_PARSE')
    assert.equal(result.diagnostics[0].source, 'broken.json')
    assert.deepEqual(result.documents[0].diagnostics, [])
    assert.deepEqual(result.statistics, {
        entryCount: 4,
        candidateCount: 3,
        documentCount: 2,
        failureCount: 1,
        totalBytes: 20
    })
    assert.doesNotThrow(() => structuredClone(result))

    const repeated = ProjectLoader.load([
        { name: './z.json', data: '[]' },
        { name: 'broken.json', data: '{' },
        { name: 'nested/../a.json', data: '[]' },
        { name: 'notes.txt', data: 'not CircuitJSON' }
    ])
    assert.equal(repeated.id, result.id)
    assert.deepEqual(repeated, result)
})

test('ProjectLoader exposes exact tryLoad discriminants and typed zero-success failures', () => {
    const success = ProjectLoader.tryLoad([{ name: 'board.json', data: '[]' }])
    assert.deepEqual(Object.keys(success), ['ok', 'value'])
    assert.equal(success.value.schema, 'ecad-toolkit.project.v1')

    const failed = ProjectLoader.tryLoad([{ name: 'bad.json', data: '{' }])
    assert.deepEqual(Object.keys(failed), ['ok', 'error', 'diagnostics'])
    assert.equal(failed.ok, false)
    assert.equal(failed.error.name, 'ToolkitError')
    assert.equal(failed.error.code, 'ERR_PROJECT_NO_DOCUMENTS')
    assert.equal(failed.error.category, 'parse')
    assert.equal(failed.diagnostics.length, 1)
    assert.equal(failed.diagnostics[0].source, 'bad.json')

    assert.throws(
        () => ProjectLoader.load([{ name: 'readme.txt', data: 'hello' }]),
        {
            name: 'ToolkitError',
            code: 'ERR_PROJECT_UNSUPPORTED',
            category: 'unsupported'
        }
    )
    assert.throws(() => ProjectLoader.load([]), {
        name: 'ToolkitError',
        code: 'ERR_PROJECT_INPUT',
        category: 'validation'
    })
})

test('ArchiveEntryPath normalizes safe relative POSIX paths and rejects unsafe names', () => {
    assert.equal(ArchiveEntryPath.normalize('./a\\x/../b.json'), 'a/b.json')
    assert.deepEqual(ArchiveEntryPath.unique(['a/./b.json', 'c\\board.json']), [
        'a/b.json',
        'c/board.json'
    ])

    for (const name of [
        '',
        '.',
        '..',
        '../board.json',
        '/board.json',
        'C:\\board.json',
        'C:board.json',
        '\\\\server\\board.json',
        'bad\0name.json'
    ]) {
        assert.throws(() => ArchiveEntryPath.normalize(name), {
            name: 'ToolkitError',
            code: 'ERR_ARCHIVE_PATH',
            category: 'validation'
        })
    }

    assert.throws(() => ArchiveEntryPath.unique(['a/../b.json', 'b.json']), {
        name: 'ToolkitError',
        code: 'ERR_ARCHIVE_DUPLICATE_ENTRY',
        category: 'validation'
    })
})

test('ArchiveLimits are immutable and accept only finite bounded own overrides', () => {
    assert.deepEqual(ArchiveLimits.defaults, {
        maxEntries: 4096,
        maxEntryBytes: 536870912,
        maxTotalBytes: 2147483648,
        maxCompressionRatio: 1000,
        maxArchiveDepth: 1
    })
    assert.equal(Object.isFrozen(ArchiveLimits.defaults), true)

    const overrides = {
        maxEntries: 4,
        maxEntryBytes: 32,
        maxTotalBytes: 64,
        maxCompressionRatio: 4.5,
        maxArchiveDepth: 0
    }
    const normalized = ArchiveLimits.normalize(overrides)

    assert.deepEqual(normalized, overrides)
    assert.notEqual(normalized, overrides)
    assert.equal(Object.isFrozen(normalized), true)
    assert.deepEqual(overrides, {
        maxEntries: 4,
        maxEntryBytes: 32,
        maxTotalBytes: 64,
        maxCompressionRatio: 4.5,
        maxArchiveDepth: 0
    })

    const invalid = [
        { maxEntries: 0 },
        { maxEntries: 1.5 },
        { maxEntries: Infinity },
        { maxEntryBytes: -1 },
        { maxTotalBytes: NaN },
        { maxCompressionRatio: 0 },
        { maxArchiveDepth: -1 },
        { maxArchiveDepth: 0.5 },
        { maxEntries: ArchiveLimits.defaults.maxEntries + 1 },
        { unknownLimit: 1 },
        Object.create({ maxEntries: 1 })
    ]
    const hidden = {}
    Object.defineProperty(hidden, 'maxEntries', { value: 1 })
    invalid.push(hidden)

    for (const value of invalid) {
        assert.throws(() => ArchiveLimits.normalize(value), {
            name: 'ToolkitError',
            code: 'ERR_ARCHIVE_LIMIT_INVALID',
            category: 'validation'
        })
    }
})

test('ProjectLoader enforces entry, byte, compression, and depth limits before parsing', () => {
    assert.throws(
        () =>
            ProjectLoader.load(
                [
                    { name: 'a.json', data: '[]' },
                    { name: 'b.json', data: '[]' }
                ],
                { archiveLimits: { maxEntries: 1 } }
            ),
        { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
    )
    assert.throws(
        () =>
            ProjectLoader.load([{ name: 'a.json', data: ' []' }], {
                archiveLimits: { maxEntryBytes: 2 }
            }),
        { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
    )
    assert.throws(
        () =>
            ProjectLoader.load(
                [
                    { name: 'a.json', data: '[]' },
                    { name: 'b.json', data: '[]' }
                ],
                { archiveLimits: { maxTotalBytes: 3 } }
            ),
        { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
    )
    assert.throws(
        () =>
            ProjectLoader.load(
                [
                    {
                        name: 'a.json',
                        data: '[ ]',
                        compressedByteLength: 1
                    }
                ],
                { archiveLimits: { maxCompressionRatio: 2 } }
            ),
        { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
    )
    assert.throws(
        () =>
            ProjectLoader.load(
                [{ name: 'a.json', data: '[]', archiveDepth: 1 }],
                { archiveLimits: { maxArchiveDepth: 0 } }
            ),
        { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
    )
})

test('ProjectLoader supports bounded canonical candidates and canonical byte inputs', () => {
    const bytes = new TextEncoder().encode('[]')

    assert.equal(
        ProjectLoader.supports([{ name: 'board.json', data: bytes }]),
        true
    )
    assert.equal(
        ProjectLoader.supports([
            { name: 'readme.txt', data: 'hello' },
            { name: 'board.json', data: bytes.buffer }
        ]),
        true
    )
    assert.equal(
        ProjectLoader.supports([{ name: 'board.json', data: '{}' }]),
        false
    )
    assert.equal(
        ProjectLoader.supports([{ name: 'readme.txt', data: '[]' }]),
        false
    )
    assert.equal(ProjectLoader.supports(null), false)

    const loaded = ProjectLoader.load([
        { name: 'b.json', data: bytes.buffer },
        { name: 'a.json', data: bytes }
    ])
    assert.deepEqual(
        loaded.documents.map((document) => document.source.fileName),
        ['a.json', 'b.json']
    )

    const unicodeData = JSON.stringify([
        {
            type: 'source_component',
            source_component_id: 'source_star',
            name: '\ud83c\udf1f',
            ftype: 'simple_chip'
        }
    ])
    const unicode = ProjectLoader.load([
        { name: 'unicode.json', data: unicodeData }
    ])
    assert.equal(
        unicode.statistics.totalBytes,
        new TextEncoder().encode(unicodeData).byteLength
    )
})

test('ProjectLoader loadAsync yields, reports monotonic progress, and checks cancellation', async () => {
    const progress = []
    const result = await ProjectLoader.loadAsync(
        [
            { name: 'b.json', data: '[]' },
            { name: 'a.json', data: '[]' }
        ],
        {
            worker: false,
            onProgress: (row) => progress.push(row)
        }
    )

    assert.equal(result.documents.length, 2)
    assert.deepEqual(
        progress.map((row) => row.stage),
        ['detect', 'project', 'project', 'project', 'complete']
    )
    assert.deepEqual(
        progress
            .filter((row) => row.stage === 'project')
            .map((row) => row.completed),
        [0, 1, 2]
    )
    assert.doesNotThrow(() => structuredClone(progress))

    const controller = new AbortController()
    await assert.rejects(
        ProjectLoader.loadAsync(
            [
                { name: 'b.json', data: '[]' },
                { name: 'a.json', data: '[]' }
            ],
            {
                signal: controller.signal,
                worker: false,
                onProgress: (row) => {
                    if (row.stage === 'project' && row.completed === 1) {
                        controller.abort()
                    }
                }
            }
        ),
        {
            name: 'ToolkitError',
            code: 'ERR_CANCELLED',
            category: 'cancelled'
        }
    )

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await assert.rejects(
        ProjectLoader.loadAsync([{ name: 'a.json', data: '[]' }], {
            signal: alreadyAborted.signal
        }),
        { code: 'ERR_CANCELLED' }
    )

    const callbackError = new Error('host project progress failed')
    await assert.rejects(
        ProjectLoader.loadAsync([{ name: 'a.json', data: '[]' }], {
            onProgress: () => {
                throw callbackError
            }
        }),
        (error) => error === callbackError
    )
})

test('ProjectLoader keeps worker transport as the shared Task 11 boundary', async () => {
    const entries = [{ name: 'board.json', data: '[]' }]

    assert.throws(() => ProjectLoader.load(entries, { worker: true }), {
        code: 'ERR_WORKER_SYNC_UNAVAILABLE'
    })
    await assert.rejects(ProjectLoader.loadAsync(entries, { worker: true }), {
        code: 'ERR_CAPABILITY_UNAVAILABLE'
    })
})
