import assert from 'node:assert/strict'
import test from 'node:test'

import { ArchiveEntryPath } from '../src/core/ArchiveEntryPath.mjs'
import { ArchiveLimits } from '../src/core/ArchiveLimits.mjs'
import { ProjectLoader } from '../src/core/ProjectLoader.mjs'
import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { ToolkitAsset } from '../src/core/contracts/ToolkitAsset.mjs'

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
    assert.equal(result.assets.length, 1)
    assert.deepEqual(result.assets[0], {
        id: result.assets[0].id,
        kind: 'companion',
        name: 'notes.txt',
        mediaType: 'application/octet-stream',
        byteLength: 15,
        data: null,
        source: { entryName: 'notes.txt' }
    })
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

    const empty = ProjectLoader.tryLoad([])
    assert.equal(empty.ok, false)
    assert.equal(empty.diagnostics.length, 1)
    assert.equal(empty.diagnostics[0].code, empty.error.code)
    assert.equal(empty.diagnostics[0].severity, 'error')

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

    assert.throws(
        () =>
            ProjectLoader.load([{ name: 'board.json', data: '[]' }], {
                reports: ['unknown-report']
            }),
        {
            name: 'ToolkitError',
            code: 'ERR_CAPABILITY_UNAVAILABLE',
            category: 'unsupported'
        }
    )
})

test('ProjectLoader normalizes hostile proxy and coercion failures to ToolkitError', () => {
    const hostileEntry = new Proxy(
        {},
        {
            getPrototypeOf() {
                throw new Error('hostile project entry')
            }
        }
    )
    const hostileName = {
        toString() {
            throw new Error('hostile entry name')
        }
    }

    for (const [entries, code] of [
        [[hostileEntry], 'ERR_PROJECT_LOAD'],
        [[{ name: hostileName, data: '[]' }], 'ERR_ARCHIVE_PATH']
    ]) {
        assert.throws(
            () => ProjectLoader.load(entries),
            (error) => error instanceof ToolkitError && error.code === code
        )
    }
})

test('ProjectLoader exposes companion entries through common asset selection', () => {
    const companion = new Uint8Array([1, 2, 3])
    const entries = [
        { name: 'board.json', data: '[]' },
        { name: 'models/body.step', data: companion }
    ]

    const none = ProjectLoader.load(entries, { decodeAssets: 'none' })
    const metadata = ProjectLoader.load(entries, { decodeAssets: 'metadata' })
    const full = ProjectLoader.load(entries, { decodeAssets: 'full' })

    assert.deepEqual(none.assets, [])
    assert.equal(metadata.assets.length, 1)
    assert.equal(metadata.assets[0].name, 'models/body.step')
    assert.equal(metadata.assets[0].byteLength, 3)
    assert.equal(metadata.assets[0].data, null)
    assert.deepEqual(metadata.assets[0].source, {
        entryName: 'models/body.step'
    })
    assert.equal(full.assets.length, 1)
    assert.notEqual(full.assets[0].data, companion)
    assert.deepEqual([...full.assets[0].data], [1, 2, 3])
    assert.deepEqual(full.documents[0].assets, [])
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

    const timerController = new AbortController()
    let timerCompleted = 0
    await assert.rejects(
        ProjectLoader.loadAsync(
            Array.from({ length: 70 }, (_, index) => ({
                name: `timer-${String(index).padStart(2, '0')}.json`,
                data: '[]'
            })),
            {
                signal: timerController.signal,
                worker: false,
                onProgress: (row) => {
                    if (row.stage !== 'project' || !row.completed) return
                    timerCompleted = row.completed
                    if (row.completed === 1) {
                        setTimeout(() => timerController.abort(), 0)
                    }
                }
            }
        ),
        { code: 'ERR_CANCELLED' }
    )
    assert.equal(timerCompleted, 1)

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

test('ProjectLoader loadAsync owns exact-window entries and assets before progress', async () => {
    const sourceBacking = new SharedArrayBuffer(6)
    const source = new Uint8Array(sourceBacking, 2, 2)
    source.set(new TextEncoder().encode('[]'))
    const attachedBacking = new SharedArrayBuffer(5)
    const attached = new Uint8Array(attachedBacking, 1, 3)
    attached.set([1, 2, 3])
    const companionBacking = new SharedArrayBuffer(4)
    const companion = new Uint8Array(companionBacking, 1, 2)
    companion.set([4, 5])
    const entries = [
        {
            name: 'board.json',
            data: source,
            assets: [{ name: 'payload.bin', data: attached }]
        },
        { name: 'notes.bin', data: companion }
    ]
    let mutated = false
    const result = await ProjectLoader.loadAsync(entries, {
        decodeAssets: 'full',
        worker: false,
        onProgress: (row) => {
            if (mutated || row.stage !== 'detect') return
            mutated = true
            source.set(new TextEncoder().encode('{}'))
            attached.fill(8)
            companion.fill(9)
        }
    })

    assert.equal(mutated, true)
    assert.deepEqual(result.documents[0].model, [])
    assert.deepEqual([...result.documents[0].assets[0].data], [1, 2, 3])
    assert.deepEqual([...result.assets[0].data], [4, 5])
    assert.deepEqual([...source], [...new TextEncoder().encode('{}')])
    assert.deepEqual([...attached], [8, 8, 8])
    assert.deepEqual([...companion], [9, 9])
})

test('ProjectLoader loadAsync prepares direct companion payloads once', async () => {
    const prepare = ToolkitAsset.prepare
    let companionCaptures = 0
    let preparedIdentity = null
    ToolkitAsset.prepare = (...arguments_) => {
        const candidate = arguments_[0]
        const prepared = prepare.call(ToolkitAsset, ...arguments_)
        if (candidate?.kind === 'companion') {
            if (preparedIdentity === null || candidate !== preparedIdentity) {
                companionCaptures += 1
                preparedIdentity = prepared
            }
        }
        return prepared
    }

    try {
        const result = await ProjectLoader.loadAsync(
            [
                { name: 'board.json', data: '[]' },
                { name: 'notes.bin', data: new Uint8Array([4, 5]) }
            ],
            { decodeAssets: 'full', worker: false }
        )

        assert.deepEqual([...result.assets[0].data], [4, 5])
        assert.equal(companionCaptures, 1)
    } finally {
        ToolkitAsset.prepare = prepare
    }
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
