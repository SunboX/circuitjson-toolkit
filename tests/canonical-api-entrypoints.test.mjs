import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { ToolkitContractFixtures } from '../src/testing.mjs'

const TEMPORARY_VIEWER_EXPORTS = [
    'CircuitJsonDocument',
    'CircuitJsonIndexer',
    'CircuitJsonUnits'
]
const COMMON_SUBPATH_EXPORTS = {
    parser: [
        'CircuitJsonDocumentContext',
        'Parser',
        'ToolkitError',
        'DocumentResult',
        'ToolkitDiagnostic',
        'ToolkitAsset',
        'ToolkitProgress',
        'TOOLKIT_WORKER_PROTOCOL',
        'ToolkitWorkerProtocol',
        'ParserWorkerClient'
    ],
    project: [
        'ProjectLoader',
        'ProjectResult',
        'ArchiveLimits',
        'ArchiveEntryPath',
        'ZipArchiveInspector'
    ],
    renderers: ['PcbSvgRenderer', 'SchematicSvgRenderer', 'BomTableRenderer'],
    interaction: ['PcbInteractionIndex', 'PcbSpatialIndex'],
    query: ['QueryService'],
    manufacturing: ['ManufacturingService'],
    simulation: ['SimulationService'],
    scene3d: [
        'PcbScene3dBuilder',
        'PcbScene3dPreparator',
        'SceneAssetResolver'
    ],
    capabilities: ['ToolkitCapabilities'],
    testing: [
        'ToolkitContractFixtures',
        'ToolkitLoopbackWorker',
        'runToolkitContract'
    ]
}

test('root exposes canonical classes plus temporary viewer compatibility', async () => {
    const root = await import('../src/index.mjs')
    assert.deepEqual(
        Object.keys(root).sort(),
        [
            ...ToolkitContractFixtures.canonicalClassNames,
            ...TEMPORARY_VIEWER_EXPORTS
        ].sort()
    )
})

test('common subpaths expose their exact canonical owners and helpers', async () => {
    for (const [subpath, names] of Object.entries(COMMON_SUBPATH_EXPORTS)) {
        assert.deepEqual(
            Object.keys(await import(`../src/${subpath}.mjs`)).sort(),
            names.toSorted()
        )
    }
})

test('package self-imports expose every common helper', async () => {
    const root = await import('circuitjson-toolkit')
    assert.deepEqual(
        Object.keys(root).sort(),
        [
            ...ToolkitContractFixtures.canonicalClassNames,
            ...TEMPORARY_VIEWER_EXPORTS
        ].sort()
    )
    for (const [subpath, names] of Object.entries(COMMON_SUBPATH_EXPORTS)) {
        assert.deepEqual(
            Object.keys(await import(`circuitjson-toolkit/${subpath}`)).sort(),
            names.toSorted()
        )
    }
})

test('extensions retain every migrated legacy public symbol', async () => {
    const extensions = await import('../src/extensions.mjs')
    const expected = [
        'CircuitJsonBomBuilder',
        'CircuitJsonElementValidator',
        'CircuitJsonManufacturingBuilder',
        'CircuitJsonManufacturingDownloadBuilder',
        'CircuitJsonParser',
        'CircuitJsonPcbClearanceDiagnostics',
        'CircuitJsonPcbCopperGeometry',
        'CircuitJsonPcbDrawingStyle',
        'CircuitJsonPcbHolePrimitiveModel',
        'CircuitJsonPcbNetMetadata',
        'CircuitJsonPcbPadPrimitiveModel',
        'CircuitJsonPcbPrimitiveArtwork',
        'CircuitJsonPcbPrimitiveAttributeRenderer',
        'CircuitJsonPcbPrimitiveBuilder',
        'CircuitJsonPcbPrimitiveFields',
        'CircuitJsonPcbPrimitiveGeometry',
        'CircuitJsonPcbPrimitiveGroups',
        'CircuitJsonPcbPrimitiveIndex',
        'CircuitJsonPcbPrimitiveOverlays',
        'CircuitJsonPcbSvgRenderer',
        'CircuitJsonPcbTraceLengthModel',
        'CircuitJsonPcbViaSvgRenderer',
        'CircuitJsonPcbZonePrimitiveBuilder',
        'CircuitJsonSchematicSvgArcPath',
        'CircuitJsonSchematicSvgPortMetadata',
        'CircuitJsonSchematicSvgPrimitiveAttributes',
        'CircuitJsonSchematicSvgRenderer',
        'CircuitJsonSchematicTableSvgRenderer',
        'CircuitJsonSourceMetadata',
        'CircuitJsonSupportMatrixBuilder',
        'PcbBoundsSelectionModel',
        'PcbCandidateSelectionModel',
        'PcbDiagnosticFocusModel',
        'PcbInteractionPrimitiveModel',
        'SelectedPartCircuitJsonExportAdapter',
        'SpiceCompatibilityPreprocessor',
        'SpiceSimulationService'
    ].sort()
    assert.deepEqual(Object.keys(extensions).sort(), expected)
    assert.deepEqual(
        Object.keys(await import('circuitjson-toolkit/extensions')).sort(),
        expected
    )
})

test('common renderer stylesheet targets canonical output classes', async () => {
    const css = await readFile(
        new URL('../src/styles/renderers.css', import.meta.url),
        'utf8'
    )
    assert.match(css, /\.pcb-svg/u)
    assert.match(css, /\.schematic-svg/u)
    assert.match(css, /\.bom-table/u)
})
