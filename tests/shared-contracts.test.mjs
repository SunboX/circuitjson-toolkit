import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { ProjectResult } from '../src/core/contracts/ProjectResult.mjs'
import { ToolkitAsset } from '../src/core/contracts/ToolkitAsset.mjs'
import { ToolkitDiagnostic } from '../src/core/contracts/ToolkitDiagnostic.mjs'
import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { ToolkitProgress } from '../src/core/contracts/ToolkitProgress.mjs'
import { ToolkitCapabilities } from '../src/core/ToolkitCapabilities.mjs'
import * as rootApi from '../src/index.mjs'

test('DocumentResult creates the canonical clone-safe envelope', () => {
    const model = []
    const result = DocumentResult.create({
        fileName: 'board.json',
        model
    })

    assert.deepEqual(Object.keys(result), [
        'schema',
        'id',
        'modelSchema',
        'model',
        'source',
        'extensions',
        'assets',
        'diagnostics',
        'statistics'
    ])
    assert.equal(result.schema, 'ecad-toolkit.document.v1')
    assert.deepEqual(result.modelSchema, {
        name: 'circuit-json',
        version: '0.0.446'
    })
    assert.equal(result.model, model)
    assert.deepEqual(result.source, {
        format: 'circuitjson',
        fileName: 'board.json',
        fileType: 'json'
    })
    assert.deepEqual(result.extensions, {})
    assert.doesNotThrow(() => structuredClone(result))
})

test('DocumentResult derives ids from source identity and keeps one native extension namespace', () => {
    const fields = {
        source: {
            format: 'gerber',
            fileName: '.\\fabrication\\top.GBR',
            fileType: 'gbr'
        },
        model: [],
        extensions: {
            gerber: {
                $meta: {
                    completeness: 'selected',
                    included: ['apertures'],
                    omitted: ['raw']
                },
                apertures: [{ id: 'D10' }]
            },
            altium: { records: ['must-not-leak'] }
        }
    }
    const first = DocumentResult.create(fields)
    const second = DocumentResult.create({
        ...fields,
        model: [{ type: 'source_component' }]
    })

    assert.equal(first.id, second.id)
    assert.deepEqual(Object.keys(first.extensions), ['gerber'])
    assert.equal(typeof first.extensions.gerber.$meta.schema, 'string')
    assert.deepEqual(first.extensions.gerber.$meta, {
        schema: first.extensions.gerber.$meta.schema,
        completeness: 'selected',
        included: ['apertures'],
        omitted: ['raw']
    })
    assert.deepEqual(first.extensions.gerber.apertures, [{ id: 'D10' }])
    assert.doesNotThrow(() => structuredClone(first))
})

test('native results keep metadata-only extension namespaces when payloads are omitted', () => {
    const document = DocumentResult.create({
        source: {
            format: 'gerber',
            fileName: 'top.gbr',
            fileType: 'gbr'
        },
        model: []
    })
    const project = ProjectResult.create({
        source: { format: 'gerber', entryNames: ['top.gbr'] },
        documents: [document],
        project: null
    })

    for (const extensions of [document.extensions, project.extensions]) {
        assert.deepEqual(extensions, {
            gerber: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'none',
                    included: [],
                    omitted: []
                }
            }
        })
    }
})

test('ToolkitDiagnostic and ToolkitAsset normalize clone-safe records', () => {
    const details = { record: 7 }
    const diagnostic = ToolkitDiagnostic.create({
        code: 'WARN_LAYER',
        severity: 'warning',
        message: 'Layer was inferred.',
        source: 'board.json',
        location: { line: 3 },
        details
    })
    const bytes = new Uint8Array([1, 2, 3])
    const asset = ToolkitAsset.create({
        kind: 'model',
        name: 'body.step',
        mediaType: 'model/step',
        data: bytes,
        source: { entryName: 'models/body.step' }
    })

    assert.deepEqual(Object.keys(diagnostic), [
        'code',
        'severity',
        'message',
        'source',
        'location',
        'details'
    ])
    assert.notEqual(diagnostic.details, details)
    assert.deepEqual(Object.keys(asset), [
        'id',
        'kind',
        'name',
        'mediaType',
        'byteLength',
        'data',
        'source'
    ])
    assert.equal(asset.byteLength, 3)
    assert.notEqual(asset.data, bytes)
    assert.deepEqual([...asset.data], [1, 2, 3])
    assert.doesNotThrow(() => structuredClone({ diagnostic, asset }))
})

test('ToolkitAsset preserves metadata sizes and emits only canonical payload types', () => {
    const bufferAsset = ToolkitAsset.create({
        name: 'body.step',
        data: new Uint8Array([4, 5]).buffer
    })
    const metadataAsset = ToolkitAsset.create({
        name: 'preview.png',
        byteLength: 42,
        data: null
    })
    const unsupportedAsset = ToolkitAsset.create({
        name: 'invalid.bin',
        data: { bytes: [1, 2] }
    })

    assert.equal(bufferAsset.data instanceof Uint8Array, true)
    assert.deepEqual([...bufferAsset.data], [4, 5])
    assert.equal(metadataAsset.data, null)
    assert.equal(metadataAsset.byteLength, 42)
    assert.equal(unsupportedAsset.data, null)
    assert.equal(unsupportedAsset.byteLength, 0)
})

test('ToolkitError serializes a normalized cause', () => {
    const nativeError = new Error('bad input')
    nativeError.code = 17
    const error = ToolkitError.from(nativeError, {
        code: 'ERR_PARSE',
        category: 'parse',
        format: 'circuitjson',
        source: 'board.json',
        details: { phase: 'decode' }
    })

    assert.equal(error.toJSON().cause.message, 'bad input')
    assert.equal(error.toJSON().cause.code, '17')
    assert.deepEqual(Object.keys(error.toJSON()), [
        'name',
        'message',
        'code',
        'category',
        'format',
        'source',
        'location',
        'details',
        'cause'
    ])
    assert.doesNotThrow(() => structuredClone(error.toJSON()))
    assert.equal(ToolkitError.from(error), error)
})

test('ProjectResult creates a clone-safe envelope without duplicating document-owned data', () => {
    const document = DocumentResult.create({
        fileName: 'top.gbr',
        model: [],
        assets: [{ kind: 'source', name: 'top.gbr', data: 'G04*' }]
    })
    const fields = {
        source: {
            format: 'gerber',
            entryNames: ['top.gbr', 'drill.xln']
        },
        documents: [document],
        project: {
            name: 'fabrication',
            relationships: [{ from: document.id, to: 'drill.xln' }]
        }
    }
    const first = ProjectResult.create(fields)
    const second = ProjectResult.create({
        ...fields,
        project: { ...fields.project, name: 'renamed' }
    })

    assert.deepEqual(Object.keys(first), [
        'schema',
        'id',
        'source',
        'documents',
        'project',
        'extensions',
        'assets',
        'diagnostics',
        'statistics'
    ])
    assert.equal(first.schema, 'ecad-toolkit.project.v1')
    assert.equal(first.id, second.id)
    assert.equal(first.documents[0], document)
    assert.deepEqual(first.assets, [])
    assert.deepEqual(first.project.documentIds, [document.id])
    assert.doesNotThrow(() => structuredClone(first))
})

test('ProjectResult preserves null projects and completes present project metadata', () => {
    const document = DocumentResult.create({
        fileName: 'board.json',
        model: []
    })
    const absent = ProjectResult.create({
        source: { format: 'circuitjson', entryNames: ['board.json'] },
        documents: [document],
        project: null
    })
    const present = ProjectResult.create({
        source: { format: 'kicad', entryNames: ['design.kicad_pro'] },
        documents: [document],
        project: { name: 'design' }
    })

    assert.equal(absent.project, null)
    assert.deepEqual(Object.keys(present.project), [
        'id',
        'name',
        'format',
        'documentIds',
        'relationships'
    ])
    assert.equal(present.project.id.length > 0, true)
    assert.equal(present.project.name, 'design')
    assert.equal(present.project.format, 'kicad')
    assert.deepEqual(present.project.documentIds, [document.id])
    assert.deepEqual(present.project.relationships, [])
})

test('ToolkitProgress keeps source detail behind common ordered stages', () => {
    const detected = ToolkitProgress.create({
        stage: 'detect',
        completed: 0,
        total: null,
        message: 'Detecting input.'
    })
    const progress = ToolkitProgress.create(
        {
            stage: 'decode',
            detail: 'commands',
            completed: 2,
            total: 4
        },
        detected
    )
    const validated = ToolkitProgress.create({ stage: 'validate' }, progress)
    const completed = ToolkitProgress.create(
        { stage: 'complete', completed: 4, total: 4 },
        validated
    )

    assert.equal(progress.stage, 'decode')
    assert.equal(progress.detail, 'commands')
    assert.doesNotThrow(() => structuredClone(progress))
    assert.throws(() => ToolkitProgress.create({ stage: 'inflate' }), {
        code: 'ERR_PROGRESS_STAGE'
    })
    assert.throws(
        () => ToolkitProgress.create({ stage: 'decode' }, validated),
        { code: 'ERR_PROGRESS_ORDER' }
    )
    assert.throws(
        () => ToolkitProgress.create({ stage: 'complete' }, completed),
        { code: 'ERR_PROGRESS_TERMINAL' }
    )
})

test('ToolkitProgress rejects invalid count contracts with typed errors', () => {
    assert.throws(
        () =>
            ToolkitProgress.create({
                stage: 'decode',
                completed: 2,
                total: 1
            }),
        { code: 'ERR_PROGRESS_COUNT' }
    )
    assert.throws(
        () => ToolkitProgress.create({ stage: 'decode', completed: -1 }),
        { code: 'ERR_PROGRESS_COUNT' }
    )
})

test('ToolkitError categories and diagnostic severities stay inside canonical unions', () => {
    const error = new ToolkitError('bad progress', { category: 'progress' })
    const diagnostic = ToolkitDiagnostic.create({ severity: 'fatal' })
    let progressError = null
    try {
        ToolkitProgress.create({ stage: 'unknown' })
    } catch (caught) {
        progressError = caught
    }

    assert.equal(error.category, 'runtime')
    assert.equal(diagnostic.severity, 'info')
    assert.equal(progressError.category, 'runtime')
})

test('ToolkitCapabilities inventories every frozen capability with stable clone-safe rows', async () => {
    const ledger = JSON.parse(
        await readFile(
            new URL('../spec/feature-preservation.json', import.meta.url),
            'utf8'
        )
    )
    const expectedIds = [
        ...new Set(ledger.map((row) => row.capabilityId))
    ].sort()
    const inventory = ToolkitCapabilities.inventory()

    assert.equal(rootApi.ToolkitCapabilities, ToolkitCapabilities)
    assert.deepEqual(
        inventory.map((row) => row.id),
        expectedIds
    )
    for (const row of inventory) {
        assert.deepEqual(Object.keys(row), [
            'id',
            'category',
            'operation',
            'status',
            'entrypoint',
            'summary',
            'reason',
            'tested',
            'documented'
        ])
        assert.equal(row.id, `${row.category}.${row.operation}`)
        assert.equal(
            ['native', 'shared', 'derived', 'unavailable'].includes(row.status),
            true
        )
        assert.equal(row.entrypoint.length > 0, true)
        assert.equal(row.summary.length > 0, true)
        assert.equal(row.reason.length > 0, true)
        assert.equal(row.tested, true)
        assert.equal(row.documented, true)
    }
    assert.doesNotThrow(() => structuredClone(inventory))

    inventory[0].summary = 'caller mutation'
    assert.notEqual(
        ToolkitCapabilities.inventory()[0].summary,
        'caller mutation'
    )
})
