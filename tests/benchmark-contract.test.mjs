import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

import { BenchmarkCaseCatalog } from '../benchmarks/BenchmarkCaseCatalog.mjs'
import { SyntheticCircuitJsonFactory } from '../benchmarks/SyntheticCircuitJsonFactory.mjs'
import { runBenchmarks } from '../scripts/run-benchmarks.mjs'
import { PcbInteractionPrimitiveModel } from '../src/index.mjs'

const repositoryRoot = new URL('../', import.meta.url)
const execFileAsync = promisify(execFile)

/**
 * Computes the benchmark report checksum used by immutable baseline records.
 * @param {Record<string, any>} reportBody Report without its checksum.
 * @returns {string} SHA-256 checksum.
 */
function benchmarkChecksum(reportBody) {
    return createHash('sha256').update(JSON.stringify(reportBody)).digest('hex')
}

/**
 * Reads one checked-in benchmark JSON artifact.
 * @param {string} path Repository-relative artifact path.
 * @returns {Promise<Record<string, any>>} Parsed artifact.
 */
async function readJson(path) {
    return JSON.parse(await readFile(new URL(path, repositoryRoot), 'utf8'))
}

test('versioned case catalog reconciles every frozen benchmark semantic', async () => {
    const catalogText = await readFile(
        new URL('benchmarks/case-catalog-v1.0.17.json', repositoryRoot),
        'utf8'
    ).catch((error) => {
        if (error?.code === 'ENOENT') return ''
        throw error
    })
    assert.notEqual(catalogText, '', 'versioned case catalog must exist')

    const catalog = JSON.parse(catalogText)
    const report = await readJson('benchmarks/baseline-v1.0.17.json')
    const { catalogChecksum, ...catalogBody } = catalog
    assert.equal(catalogChecksum, benchmarkChecksum(catalogBody))
    assert.equal(report.caseCatalogChecksum, catalogChecksum)
    assert.deepEqual(report.measurementContract, catalog.measurement)
    assert.equal(report.fixtureChecksum, catalog.fixture.checksum)
    assert.deepEqual(
        report.cases.map((entry) => ({
            id: entry.id,
            primary: entry.primary,
            warmups: entry.warmups,
            sampleCount: entry.sampleCount,
            workload: entry.workload,
            cloneTarget: entry.cloneTarget,
            expectedResult: entry.expectedResult,
            expectedCloneBytes: entry.cloneBytes
        })),
        catalog.cases
    )

    for (const entry of report.cases) {
        const sorted = [...entry.samples].sort((left, right) => left - right)
        assert.equal(
            entry.medianMilliseconds,
            sorted[Math.floor(sorted.length / 2)],
            entry.id
        )
        assert.equal(
            entry.retainedHeap.retainedBytes,
            Math.max(
                0,
                entry.retainedHeap.afterBytes - entry.retainedHeap.beforeBytes
            ),
            entry.id
        )
    }
})

test('catalog-driven suite satisfies deterministic workload and clone expectations', async () => {
    const { stdout } = await execFileAsync(
        process.execPath,
        ['--expose-gc', 'scripts/run-benchmarks.mjs'],
        { cwd: new URL('.', repositoryRoot) }
    )
    const report = JSON.parse(stdout)
    const catalog = await readJson('benchmarks/case-catalog-v1.0.17.json')

    assert.equal(report.fixtureChecksum, catalog.fixture.checksum)
    assert.deepEqual(
        report.cases.map((entry) => ({
            id: entry.id,
            result: entry.expectedResult,
            cloneBytes: entry.cloneBytes
        })),
        catalog.cases.map((entry) => ({
            id: entry.id,
            result: entry.expectedResult,
            cloneBytes: entry.expectedCloneBytes
        }))
    )
})

test('hit-test workload result counts returned candidates', async () => {
    const catalog = await readJson('benchmarks/case-catalog-v1.0.17.json')
    const benchmarkCase = catalog.cases.find(
        (entry) => entry.workload.operation === 'grid-hit-test'
    )
    const workload = benchmarkCase.workload
    const document = SyntheticCircuitJsonFactory.interactiveBoard(
        catalog.fixture.interactiveBoard
    )
    let candidateCount = 0
    for (let index = 0; index < workload.iterations; index += 1) {
        candidateCount += PcbInteractionPrimitiveModel.hitTest(
            document,
            {
                x:
                    (index % workload.xCycle) * workload.spacing +
                    workload.xOffset,
                y:
                    (index % workload.yCycle) * workload.spacing +
                    workload.yOffset
            },
            { tolerance: workload.tolerance }
        ).length
    }

    assert.equal(workload.resultMetric, 'candidate-count')
    assert.equal(benchmarkCase.expectedResult, candidateCount)
})

test('versioned catalog rejects an internally rechecksummed semantic mutation', async (context) => {
    const outputUrl = new URL(
        `benchmarks/.case-catalog-${process.pid}.json`,
        repositoryRoot
    )
    context.after(() => rm(outputUrl, { force: true }))
    const catalog = await readJson('benchmarks/case-catalog-v1.0.17.json')
    catalog.cases[0].warmups += 1
    const { catalogChecksum: discardedChecksum, ...catalogBody } = catalog
    assert.equal(typeof discardedChecksum, 'string')
    catalog.catalogChecksum = benchmarkChecksum(catalogBody)
    await writeFile(outputUrl, JSON.stringify(catalog, null, 4) + '\n')

    assert.throws(
        () => BenchmarkCaseCatalog.load(outputUrl),
        /immutable versioned contract/
    )
})

test('existing baseline validation rejects internally rechecksummed semantic mutations', async (context) => {
    const original = await readJson('benchmarks/baseline-v1.0.17.json')
    const mutations = [
        [
            'fixture checksum',
            (report) => (report.fixtureChecksum = '0'.repeat(64))
        ],
        ['case order', (report) => report.cases.reverse()],
        ['primary flag', (report) => (report.cases[0].primary = false)],
        ['warmup count', (report) => (report.cases[0].warmups += 1)],
        ['sample count', (report) => (report.cases[0].sampleCount += 1)],
        [
            'workload descriptor',
            (report) => (report.cases[1].workload.iterations += 1)
        ],
        ['clone size', (report) => (report.cases[0].cloneBytes += 1)],
        ['median', (report) => (report.cases[0].medianMilliseconds += 1)],
        [
            'retained bytes',
            (report) => (report.cases[0].retainedHeap.retainedBytes += 1)
        ]
    ]

    for (let index = 0; index < mutations.length; index += 1) {
        const [name, mutate] = mutations[index]
        const recordPath = `benchmarks/.semantic-contract-${process.pid}-${index}.json`
        const outputUrl = new URL(recordPath, repositoryRoot)
        context.after(() => rm(outputUrl, { force: true }))
        const report = structuredClone(original)
        mutate(report)
        const { reportChecksum: discardedChecksum, ...reportBody } = report
        assert.equal(typeof discardedChecksum, 'string')
        report.reportChecksum = benchmarkChecksum(reportBody)
        await writeFile(outputUrl, JSON.stringify(report, null, 4) + '\n')

        await assert.rejects(
            () => runBenchmarks(['--record', recordPath]),
            /approved versioned contract/,
            name
        )
    }
})
