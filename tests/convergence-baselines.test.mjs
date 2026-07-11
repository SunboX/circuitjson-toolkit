import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CircuitJsonPcbPrimitiveFields } from '../src/extensions.mjs'

const REQUIRED_BENCHMARK_CASES = [
    { id: 'parse-context-50000', primary: true },
    { id: 'repeated-query-hit-test', primary: true },
    { id: 'repeated-netlist-query', primary: false },
    { id: 'multi-layer-render', primary: false },
    { id: 'context-reuse', primary: false }
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

test('API baseline records typed source evidence for every field and option', async () => {
    const api = await readJson('spec/api-baseline-v1.0.17.json')
    const fields = api.features.filter((entry) => entry.kind === 'field')
    const options = api.features.filter((entry) => entry.kind === 'option')

    assert.ok(fields.length > 0)
    assert.ok(options.length > 0)
    assert.ok(
        fields.every((field) => field.sourceContract?.type === 'result-field')
    )
    assert.ok(
        options.every((option) =>
            ['argument', 'property'].includes(option.sourceContract?.type)
        )
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
    assert.equal(
        shared.replacement,
        'circuitjson-toolkit/extensions#CircuitJsonParser'
    )
    assert.equal(extension.disposition, 'shared')
    assert.equal(
        extension.replacement,
        'circuitjson-toolkit/extensions#CircuitJsonPcbPrimitiveFields'
    )
    assert.equal(typeof CircuitJsonPcbPrimitiveFields.boardBounds, 'function')
    assert.equal(extension.availability['gerber-toolkit'], 'derived')
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
