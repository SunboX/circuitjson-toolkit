import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const REQUIRED_BENCHMARK_CASES = [
    { id: 'parse-context-50000', primary: true },
    { id: 'repeated-query-hit-test', primary: true },
    { id: 'repeated-netlist-query', primary: false },
    { id: 'multi-layer-render', primary: false },
    { id: 'context-reuse', primary: false }
]

const REQUIRED_INDEX_FIELDS = [
    'indexResult.componentsBySourceId',
    'indexResult.diagnostics',
    'indexResult.elements',
    'indexResult.elementsByGroupId',
    'indexResult.elementsById',
    'indexResult.elementsBySubcircuitId',
    'indexResult.elementsByType',
    'indexResult.groupsById',
    'indexResult.pcbComponentById',
    'indexResult.relationsByField',
    'indexResult.sourceComponentById',
    'indexResult.sourceTraceById',
    'indexResult.sourceTraceConnectivity'
]

const REQUIRED_DOCUMENT_METADATA_FIELDS = [
    'parserResult.bom',
    'parserResult.diagnostics',
    'parserResult.fileName',
    'parserResult.fileType',
    'parserResult.kind',
    'parserResult.manufacturing',
    'parserResult.sourceFormat',
    'parserResult.supportMatrix'
]

const REQUIRED_PUBLIC_OPTIONS = [
    'CircuitJsonDocument.attachMetadata.metadata.bom',
    'CircuitJsonDocument.attachMetadata.metadata.diagnostics',
    'CircuitJsonDocument.attachMetadata.metadata.fileName',
    'CircuitJsonDocument.attachMetadata.metadata.fileType',
    'CircuitJsonDocument.attachMetadata.metadata.kind',
    'CircuitJsonDocument.attachMetadata.metadata.manufacturing',
    'CircuitJsonDocument.attachMetadata.metadata.supportMatrix',
    'CircuitJsonParser.parseBytes.options.fileName',
    'CircuitJsonParser.parseText.options.fileName',
    'CircuitJsonPcbPrimitiveOverlays.build.groupModel.anchorOffsets',
    'CircuitJsonPcbPrimitiveOverlays.build.groupModel.groups',
    'CircuitJsonPcbSvgRenderer.render.options.side',
    'CircuitJsonSchematicSvgPrimitiveAttributes.attributes.options.fill',
    'CircuitJsonSourceMetadata.normalizeSourceNetName.options.fallback',
    'CircuitJsonSourceMetadata.normalizeSourceNetName.options.usedNames',
    'CircuitJsonSourceMetadata.normalizeSourcePortName.options.fallback',
    'CircuitJsonSourceMetadata.normalizeSourcePortName.options.usedNames',
    'PcbBoundsSelectionModel.resolve.options.hiddenLayers',
    'PcbBoundsSelectionModel.resolve.options.hiddenObjects',
    'PcbBoundsSelectionModel.resolve.options.side',
    'PcbInteractionPrimitiveModel.hitTest.options.hiddenLayers',
    'PcbInteractionPrimitiveModel.hitTest.options.hiddenObjects',
    'PcbInteractionPrimitiveModel.hitTest.options.side',
    'PcbInteractionPrimitiveModel.hitTest.options.tolerance',
    'PcbInteractionPrimitiveModel.resolveSnapPoint.options.tolerance',
    'SelectedPartCircuitJsonExportAdapter.build.selectedPart.designator',
    'SelectedPartCircuitJsonExportAdapter.build.selectedPart.footprint',
    'SelectedPartCircuitJsonExportAdapter.build.selectedPart.symbol',
    'SpiceSimulationService.constructor.dependencies.engine'
]

const REQUIRED_PUBLIC_FIELDS = [
    'boundsSelectionResult.bounds',
    'boundsSelectionResult.candidates',
    'boundsSelectionResult.componentKeys',
    'boundsSelectionResult.netNames',
    'boundsSelectionResult.point',
    'boundsSelectionResult.selectedCandidate',
    ...REQUIRED_INDEX_FIELDS,
    'manufacturingDownloadResult.bytes',
    'manufacturingDownloadResult.contentType',
    'manufacturingDownloadResult.fileName',
    'manufacturingResult.fabricationNotes',
    'manufacturingResult.pickAndPlaceRows',
    'manufacturingResult.routingDsn',
    'manufacturingResult.routingGuides',
    ...REQUIRED_DOCUMENT_METADATA_FIELDS,
    'pcbPrimitiveModelResult.airwires',
    'pcbPrimitiveModelResult.anchorOffsets',
    'pcbPrimitiveModelResult.anchors',
    'pcbPrimitiveModelResult.bounds',
    'pcbPrimitiveModelResult.components',
    'pcbPrimitiveModelResult.diagnostics',
    'pcbPrimitiveModelResult.groups',
    'pcbPrimitiveModelResult.layers',
    'pcbPrimitiveModelResult.nets',
    'pcbPrimitiveModelResult.primitives',
    'pcbPrimitiveModelResult.traceLengths',
    'pcbPrimitiveModelResult.virtualLayers',
    'simulationResult.diagnostics',
    'simulationResult.graphSummary',
    'simulationResult.simulationCircuitJson',
    'simulationResult.simulationResultCircuitJson',
    'sourceMetadataResult.componentIcon',
    'sourceMetadataResult.componentType',
    'sourceMetadataResult.sourceFtype',
    'sourceMetadataResult.supplierPartNumber',
    'sourceMetadataResult.supplierPartNumbers',
    'supportMatrixResult.gaps',
    'supportMatrixResult.rows',
    'supportMatrixResult.sourceFormat',
    'supportMatrixResult.totals',
    'supportMatrixResult.variantRows'
]

const REQUIRED_PROVENANCE = {
    sourceCommit: '8c9d7deb0229d7d7d8d2f7bdcd621933e88753f9',
    sourceTree: '6740d0a6d8a1c0db3da7423c6595b8231d392f0d'
}

/**
 * Reads one repository JSON artifact.
 * @param {string} path Repository-relative path.
 * @returns {Promise<any>} Parsed JSON value.
 */
async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'))
}

test('convergence baselines identify immutable source versions and primary cases', async () => {
    const source = await readJson('spec/circuitjson-schema-source.json')
    const api = await readJson('spec/api-baseline-v1.0.17.json')
    const benchmark = await readJson('benchmarks/baseline-v1.0.17.json')
    const provenance = await readJson('spec/baseline-provenance-v1.0.17.json')
    assert.equal(source.package, 'circuit-json')
    assert.equal(source.version, '0.0.446')
    assert.equal(api.packageVersion, '1.0.17')
    assert.deepEqual(api.provenance, REQUIRED_PROVENANCE)
    assert.deepEqual(benchmark.provenance, REQUIRED_PROVENANCE)
    assert.deepEqual(
        {
            sourceCommit: provenance.sourceCommit,
            sourceTree: provenance.sourceTree
        },
        REQUIRED_PROVENANCE
    )
    assert.equal(benchmark.cases.filter((entry) => entry.primary).length, 2)
})

test('API baseline freezes every documented index, metadata, and option field', async () => {
    const api = await readJson('spec/api-baseline-v1.0.17.json')
    const fields = api.features
        .filter((entry) => entry.kind === 'field')
        .map((entry) => entry.feature)
        .sort()
    const options = api.features
        .filter((entry) => entry.kind === 'option')
        .map((entry) => entry.feature)
        .sort()

    assert.deepEqual(fields, [...REQUIRED_PUBLIC_FIELDS].sort())
    assert.deepEqual(options, REQUIRED_PUBLIC_OPTIONS)

    assert.deepEqual(
        fields.filter((field) => field.startsWith('indexResult.')),
        REQUIRED_INDEX_FIELDS
    )
    assert.deepEqual(
        fields.filter((field) => field.startsWith('parserResult.')),
        REQUIRED_DOCUMENT_METADATA_FIELDS
    )
})

test('feature baseline records explicit shared and extension preservation evidence', async () => {
    const api = await readJson('spec/api-baseline-v1.0.17.json')
    const shared = api.features.find(
        (entry) => entry.feature === '.#CircuitJsonParser'
    )
    const extension = api.features.find(
        (entry) => entry.feature === './renderers#CircuitJsonPcbPrimitiveFields'
    )

    assert.equal(shared.disposition, 'shared')
    assert.match(shared.replacement, /^Parser\./)
    assert.equal(extension.disposition, 'native-extension')
    assert.equal(extension.availability['gerber-toolkit'], 'unavailable')
    assert.equal(
        api.features.some((entry) =>
            String(entry.replacement).startsWith(
                'circuitjson-toolkit baseline '
            )
        ),
        false
    )
})

test('benchmark baseline freezes the complete nonnegative measurement contract', async () => {
    const benchmark = await readJson('benchmarks/baseline-v1.0.17.json')
    const { reportChecksum, ...reportBody } = benchmark
    assert.equal(
        reportChecksum,
        createHash('sha256').update(JSON.stringify(reportBody)).digest('hex')
    )
    assert.deepEqual(
        benchmark.cases.map(({ id, primary }) => ({ id, primary })),
        REQUIRED_BENCHMARK_CASES
    )
    assert.equal(
        new Set(benchmark.cases.map((entry) => entry.id)).size,
        REQUIRED_BENCHMARK_CASES.length
    )
    assert.match(benchmark.environment.node, /^v20\./)
    assert.equal(typeof benchmark.environment.platform, 'string')
    assert.equal(typeof benchmark.environment.architecture, 'string')
    assert.equal(typeof benchmark.environment.cpu, 'string')
    assert.equal(Number.isInteger(benchmark.environment.logicalCpuCount), true)
    assert.match(benchmark.fixtureChecksum, /^[a-f0-9]{64}$/)

    for (const entry of benchmark.cases) {
        assert.equal(Number.isInteger(entry.warmups), true, entry.id)
        assert.equal(entry.warmups > 0, true, entry.id)
        assert.equal(Array.isArray(entry.samples), true, entry.id)
        assert.equal(entry.samples.length > 0, true, entry.id)
        assert.equal(
            entry.samples.every(
                (sample) => Number.isFinite(sample) && sample >= 0
            ),
            true,
            entry.id
        )
        assert.equal(
            Number.isFinite(entry.medianMilliseconds) &&
                entry.medianMilliseconds >= 0,
            true,
            entry.id
        )
        assert.equal(Number.isInteger(entry.cloneBytes), true, entry.id)
        assert.equal(entry.cloneBytes > 0, true, entry.id)
        assert.equal(entry.retainedHeap.gcControlled, true, entry.id)
        for (const field of ['beforeBytes', 'afterBytes', 'retainedBytes']) {
            assert.equal(
                Number.isInteger(entry.retainedHeap[field]) &&
                    entry.retainedHeap[field] >= 0,
                true,
                `${entry.id}:${field}`
            )
        }
    }
})
