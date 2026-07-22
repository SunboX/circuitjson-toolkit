import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkFeaturePreservation } from '../scripts/check-feature-preservation.mjs'
import * as rootApi from '../src/index.mjs'
import { CircuitJsonDocument } from '../src/core/CircuitJsonDocument.mjs'
import { ProjectLoader } from '../src/core/ProjectLoader.mjs'
import { Parser } from '../src/core/Parser.mjs'
import { ToolkitAsset } from '../src/core/contracts/ToolkitAsset.mjs'
import { ParserWorkerClient } from '../src/core/worker/ParserWorkerClient.mjs'
import * as extensionsApi from '../src/extensions.mjs'
import { ToolkitLoopbackWorker } from '../src/testing/ToolkitLoopbackWorker.mjs'

const repositoryRoot = new URL('../', import.meta.url)

/**
 * Creates one minimal valid board element.
 * @returns {Record<string, any>} CircuitJSON board.
 */
function board() {
    return {
        type: 'pcb_board',
        pcb_board_id: 'board',
        center: { x: 0, y: 0 }
    }
}

test('public validation rejects sparse and accessor-backed graphs without executing accessors', () => {
    const sparse = new Array(1)
    assert.equal(CircuitJsonDocument.validateModel(sparse).length > 0, true)

    let reads = 0
    const accessorElement = board()
    Object.defineProperty(accessorElement, 'type', {
        enumerable: true,
        get() {
            reads += 1
            return 'pcb_board'
        }
    })
    assert.equal(
        CircuitJsonDocument.validateModel([accessorElement]).length > 0,
        true
    )

    const nestedAccessor = board()
    Object.defineProperty(nestedAccessor.center, 'x', {
        enumerable: true,
        get() {
            reads += 1
            return 0
        }
    })
    assert.equal(
        CircuitJsonDocument.validateModel([nestedAccessor]).length > 0,
        true
    )

    const accessorArray = []
    Object.defineProperty(accessorArray, '0', {
        configurable: true,
        enumerable: true,
        get() {
            reads += 1
            return board()
        }
    })
    accessorArray.length = 1
    assert.equal(
        CircuitJsonDocument.validateModel(accessorArray).length > 0,
        true
    )
    assert.equal(reads, 0)
})

test('parser and project list validation never dispatches caller iteration accessors', () => {
    let reads = 0
    const reports = []
    Object.defineProperty(reports, 'map', {
        configurable: true,
        get() {
            reads += 1
            return Array.prototype.map
        }
    })
    assert.throws(
        () => Parser.parse({ fileName: 'board.json', data: '[]' }, { reports }),
        { code: 'ERR_CIRCUITJSON_PARSE' }
    )

    const entries = [{ name: 'board.json', data: '[]' }]
    Object.defineProperty(entries, Symbol.iterator, {
        configurable: true,
        get() {
            reads += 1
            return Array.prototype[Symbol.iterator]
        }
    })
    assert.throws(() => ProjectLoader.load(entries), {
        code: 'ERR_PROJECT_INPUT'
    })
    assert.equal(reads, 0)
})

test('ToolkitAsset prepares dense lists with zero-copy metadata and one owned full snapshot', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const measured = []
    const metadata = ToolkitAsset.prepareAll(
        [{ name: 'body.step', data: bytes }],
        {
            mode: 'metadata',
            acceptPayload: (byteLength) => measured.push(byteLength)
        }
    )
    assert.equal(ToolkitAsset.measure({ data: bytes }), 3)
    assert.equal(metadata[0].byteLength, 3)
    assert.equal(metadata[0].data, null)
    assert.deepEqual(measured, [3])

    const full = ToolkitAsset.prepareAll([{ name: 'body.step', data: bytes }], {
        mode: 'full'
    })
    bytes[0] = 9
    assert.deepEqual([...full[0].data], [1, 2, 3])
    assert.equal(ToolkitAsset.prepare(full[0], { mode: 'full' }), full[0])

    const ignored = []
    assert.deepEqual(
        ToolkitAsset.prepareAll([{ data: 'abc' }], {
            mode: 'none',
            acceptPayload: (byteLength) => ignored.push(byteLength)
        }),
        []
    )
    assert.deepEqual(ignored, [3])
})

test('ToolkitAsset infers canonical ECAD asset media types without overriding explicit values', () => {
    const assets = ToolkitAsset.prepareAll(
        [
            { name: 'models/body.WRL', data: new Uint8Array() },
            { name: 'models/body.vrml', data: new Uint8Array() },
            { name: 'models/body.step', data: new Uint8Array() },
            { name: 'preview.svg', data: '' },
            {
                name: 'models/custom.step',
                mediaType: 'application/x-custom',
                data: new Uint8Array()
            }
        ],
        { mode: 'metadata' }
    )

    assert.deepEqual(
        assets.map((asset) => asset.mediaType),
        [
            'model/vrml',
            'model/vrml',
            'model/step',
            'image/svg+xml',
            'application/x-custom'
        ]
    )
})

test('ToolkitAsset rejects sparse lists and accessors without executing them', () => {
    let reads = 0
    const asset = {}
    Object.defineProperty(asset, 'data', {
        enumerable: true,
        get() {
            reads += 1
            return 'unsafe'
        }
    })
    assert.throws(
        () => ToolkitAsset.prepare(asset, { mode: 'metadata' }),
        TypeError
    )
    assert.equal(reads, 0)
    assert.throws(
        () => ToolkitAsset.prepareAll(new Array(1), { mode: 'none' }),
        TypeError
    )
})

test('project archive limits include attached assets in every decode mode', () => {
    const entries = [
        {
            name: 'board.json',
            data: '[]',
            assets: [{ name: 'body.step', data: new Uint8Array([1, 2, 3]) }]
        }
    ]
    for (const decodeAssets of ['none', 'metadata', 'full']) {
        assert.throws(
            () =>
                ProjectLoader.load(entries, {
                    decodeAssets,
                    archiveLimits: { maxEntryBytes: 4 }
                }),
            { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
        )
        assert.throws(
            () =>
                ProjectLoader.load(entries, {
                    decodeAssets,
                    archiveLimits: { maxTotalBytes: 4 }
                }),
            { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
        )
    }
})

test('worker project loading applies attached-asset archive limits before dispatch', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    const observations = { parse: 0, loadProject: 0 }
    Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: ToolkitLoopbackWorker.constructorFor(rootApi, observations),
        writable: true
    })
    try {
        await assert.rejects(
            () =>
                ProjectLoader.loadAsync(
                    [
                        {
                            name: 'board.json',
                            data: '[]',
                            assets: [
                                {
                                    name: 'body.step',
                                    data: new Uint8Array([1, 2, 3])
                                }
                            ]
                        }
                    ],
                    {
                        worker: true,
                        decodeAssets: 'none',
                        archiveLimits: { maxEntryBytes: 4 }
                    }
                ),
            { code: 'ERR_ARCHIVE_LIMIT_EXCEEDED' }
        )
        assert.equal(observations.loadProject, 0)
    } finally {
        ParserWorkerClient.disposeDefault()
        if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
        else delete globalThis.Worker
    }
})

test('direct parser and project paths reject 100001 attached values before preparation', () => {
    let reads = 0
    const hostileAsset = {}
    Object.defineProperty(hostileAsset, 'data', {
        enumerable: true,
        get() {
            reads += 1
            return 'unsafe'
        }
    })
    const assets = new Array(100_001).fill(hostileAsset)

    assert.throws(
        () => Parser.parse({ fileName: 'limit.json', data: '[]', assets }),
        {
            name: 'ToolkitError',
            code: 'ERR_ATTACHED_VALUE_LIMIT_EXCEEDED',
            category: 'validation'
        }
    )
    assert.throws(
        () => ProjectLoader.load([{ name: 'limit.json', data: '[]', assets }]),
        {
            name: 'ToolkitError',
            code: 'ERR_ATTACHED_VALUE_LIMIT_EXCEEDED',
            category: 'validation'
        }
    )
    assert.equal(reads, 0)
})

test('worker parser and project paths share the attached-value preflight ceiling', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    const observations = { parse: 0, loadProject: 0 }
    Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: ToolkitLoopbackWorker.constructorFor(rootApi, observations),
        writable: true
    })
    const assets = new Array(100_001).fill({ data: null })
    try {
        await assert.rejects(
            Parser.parseAsync(
                { fileName: 'limit.json', data: '[]', assets },
                { worker: true }
            ),
            {
                name: 'ToolkitError',
                code: 'ERR_ATTACHED_VALUE_LIMIT_EXCEEDED',
                category: 'validation'
            }
        )
        await assert.rejects(
            ProjectLoader.loadAsync(
                [{ name: 'limit.json', data: '[]', assets }],
                { worker: true }
            ),
            {
                name: 'ToolkitError',
                code: 'ERR_ATTACHED_VALUE_LIMIT_EXCEEDED',
                category: 'validation'
            }
        )
        assert.deepEqual(observations, { parse: 0, loadProject: 0 })
    } finally {
        ParserWorkerClient.disposeDefault()
        if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
        else delete globalThis.Worker
    }
})

test('historical inventory pin rejects matching baseline and ledger deletion', async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'circuitjson-pin-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    const api = JSON.parse(
        await readFile(
            new URL('spec/api-baseline-v1.0.17.json', repositoryRoot),
            'utf8'
        )
    )
    const ledger = JSON.parse(
        await readFile(
            new URL('spec/feature-preservation.json', repositoryRoot),
            'utf8'
        )
    )
    const removed = api.features.pop()
    const ledgerIndex = ledger.findIndex(
        (row) => row.feature === removed.feature
    )
    ledger.splice(ledgerIndex, 1)
    const apiPath = join(directory, 'api.json')
    const ledgerPath = join(directory, 'ledger.json')
    await Promise.all([
        writeFile(apiPath, JSON.stringify(api)),
        writeFile(ledgerPath, JSON.stringify(ledger))
    ])

    await assert.rejects(
        () =>
            checkFeaturePreservation({
                apiPath,
                ledgerPath,
                repositoryRoot: fileURLToPath(repositoryRoot)
            }),
        /immutable historical API inventory/u
    )
})

test('legacy contracts have exact extension owners and four-toolkit availability', async () => {
    const baseline = JSON.parse(
        await readFile(
            new URL('spec/api-baseline-v1.0.17.json', repositoryRoot),
            'utf8'
        )
    )
    const historicalExports = new Set(
        baseline.entrypoints.flatMap((entrypoint) =>
            entrypoint.exports.map((entry) => entry.name)
        )
    )
    const retainedRoot = new Set([
        'CircuitJsonDocument',
        'CircuitJsonIndexer',
        'CircuitJsonUnits'
    ])
    assert.deepEqual(
        Object.keys(extensionsApi).toSorted(),
        [...historicalExports]
            .filter((name) => !retainedRoot.has(name))
            .toSorted()
    )
    for (const feature of baseline.features.filter(
        (entry) => entry.exportName
    )) {
        const owner = feature.exportName.replaceAll('$', '\\$&')
        const entrypoint = retainedRoot.has(feature.exportName)
            ? 'circuitjson-toolkit'
            : 'circuitjson-toolkit/extensions'
        assert.match(
            feature.replacement,
            new RegExp(`^${entrypoint}#${owner}`, 'u'),
            feature.feature
        )
        assert.equal(feature.disposition, 'shared', feature.feature)
        assert.equal(
            Object.values(feature.availability).every(
                (status) => status === 'shared' || status === 'derived'
            ),
            true,
            feature.feature
        )
    }
})

test('root is the exact 18-class CircuitJSON contract', () => {
    const expected = [
        'Parser',
        'ProjectLoader',
        'CircuitJsonDocumentContext',
        'PcbSvgRenderer',
        'SchematicSvgRenderer',
        'BomTableRenderer',
        'PcbInteractionIndex',
        'QueryService',
        'ManufacturingService',
        'SimulationService',
        'PcbScene3dBuilder',
        'PcbScene3dPreparator',
        'SelfAdjustingComputation',
        'ToolkitCapabilities',
        'ToolkitError',
        'CircuitJsonDocument',
        'CircuitJsonIndexer',
        'CircuitJsonUnits'
    ].toSorted()
    assert.deepEqual(Object.keys(rootApi).toSorted(), expected)
    assert.equal(
        Object.values(rootApi).every((value) => typeof value === 'function'),
        true
    )
})
