import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { BenchmarkCaseCatalog } from '../benchmarks/BenchmarkCaseCatalog.mjs'
import { SyntheticCircuitJsonFactory } from '../benchmarks/SyntheticCircuitJsonFactory.mjs'
import {
    compareBenchmarkReports,
    runBenchmarks
} from '../scripts/run-benchmarks.mjs'
import { PcbInteractionIndex } from '../src/interaction.mjs'

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
 * Recomputes one report checksum after an adversarial mutation.
 * @param {Record<string, any>} report Complete benchmark report.
 * @returns {void}
 */
function rechecksum(report) {
    const { reportChecksum: discardedChecksum, ...body } = report
    assert.equal(typeof discardedChecksum, 'string')
    report.reportChecksum = benchmarkChecksum(body)
}

/**
 * Scales timing samples and reconciles their median.
 * @param {Record<string, any>} entry Benchmark case report.
 * @param {number} factor Timing scale factor.
 * @returns {void}
 */
function scaleSamples(entry, factor) {
    entry.samples = entry.samples.map((sample) =>
        Number((sample * factor).toFixed(6))
    )
    const sorted = [...entry.samples].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    entry.medianMilliseconds =
        sorted.length % 2 === 1
            ? sorted[middle]
            : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(6))
}

/**
 * Builds an internally valid current report that satisfies all release gates.
 * @param {Record<string, any>} baseline Approved historical baseline.
 * @returns {Record<string, any>} Valid current comparison report body.
 */
function passingCurrentReport(baseline) {
    const current = structuredClone(baseline)
    delete current.reportChecksum
    current.packageVersion = '1.1.0'
    current.candidateProvenance = {
        schema: 'ecad-toolkit.candidate-provenance.v1',
        packageName: 'circuitjson-toolkit',
        packageVersion: '1.1.0',
        sourceCommit: 'a'.repeat(40),
        sourceDigest: 'b'.repeat(64),
        tarballSha256: 'c'.repeat(64)
    }
    current.execution = {
        schema: 'ecad-toolkit.benchmark-execution.v1',
        target: 'packed-candidate',
        packageVersion: current.candidateProvenance.packageVersion,
        sourceDigest: current.candidateProvenance.sourceDigest
    }
    for (const entry of current.cases) {
        if (entry.primary) scaleSamples(entry, 0.79)
        if (entry.id === 'context-reuse') {
            entry.cloneBytes = Math.floor(entry.cloneBytes * 0.74)
        }
        entry.processCount = 3
        entry.processMedians = new Array(3).fill(entry.medianMilliseconds)
    }
    return current
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

test('checked-in 1.1.0 benchmark evidence reconciles its packed execution and checksum', async () => {
    const report = await readJson('benchmarks/results-v1.1.0.json')
    const baseline = await readJson('benchmarks/baseline-v1.0.17.json')
    const { reportChecksum, ...body } = report

    assert.equal(reportChecksum, benchmarkChecksum(body))
    assert.equal(report.comparison.passed, true)
    assert.deepEqual(report.execution, {
        schema: 'ecad-toolkit.benchmark-execution.v1',
        target: 'packed-candidate',
        packageVersion: report.candidateProvenance.packageVersion,
        sourceDigest: report.candidateProvenance.sourceDigest
    })
    assert.equal(
        report.execution.sourceDigest,
        report.candidateProvenance.sourceDigest
    )
    assert.equal(compareBenchmarkReports(report, baseline).passed, true)
})

test('catalog-driven suite satisfies deterministic workload and clone expectations', async () => {
    const { stdout } = await execFileAsync(
        process.execPath,
        ['--expose-gc', 'scripts/run-benchmarks.mjs'],
        { cwd: new URL('.', repositoryRoot) }
    )
    const report = JSON.parse(stdout)
    const catalog = await readJson('benchmarks/case-catalog-v1.0.17.json')
    const baseline = await readJson('benchmarks/baseline-v1.0.17.json')
    const packageMetadata = await readJson('package.json')

    assert.equal(report.packageVersion, packageMetadata.version)
    assert.equal(report.candidateProvenance.packageName, 'circuitjson-toolkit')
    assert.equal(
        report.candidateProvenance.packageVersion,
        packageMetadata.version
    )
    assert.match(report.candidateProvenance.sourceDigest, /^[a-f0-9]{64}$/u)
    assert.match(report.candidateProvenance.tarballSha256, /^[a-f0-9]{64}$/u)
    assert.deepEqual(report.execution, {
        schema: 'ecad-toolkit.benchmark-execution.v1',
        target: 'packed-candidate',
        packageVersion: report.candidateProvenance.packageVersion,
        sourceDigest: report.candidateProvenance.sourceDigest
    })
    assert.equal(
        report.cases.every(
            (entry) =>
                entry.processCount >= 3 &&
                entry.processMedians.length === entry.processCount
        ),
        true
    )
    assert.equal(report.fixtureChecksum, catalog.fixture.checksum)
    assert.deepEqual(
        report.cases.map((entry) => ({
            id: entry.id,
            result: entry.expectedResult
        })),
        catalog.cases.map((entry) => ({
            id: entry.id,
            result: entry.expectedResult
        }))
    )
    const context = report.cases.find((entry) => entry.id === 'context-reuse')
    const baselineContext = baseline.cases.find(
        (entry) => entry.id === 'context-reuse'
    )
    assert.equal(context.cloneBytes <= baselineContext.cloneBytes * 0.75, true)
})

test('candidate benchmark processes import toolkit modules from the supplied package root', async (context) => {
    const emptyPackage = await mkdtemp(
        join(tmpdir(), 'circuitjson-empty-candidate-')
    )
    context.after(() => rm(emptyPackage, { recursive: true, force: true }))

    await assert.rejects(
        execFileAsync(
            process.execPath,
            ['--expose-gc', 'scripts/run-benchmarks.mjs', '--sample-process'],
            {
                cwd: new URL('.', repositoryRoot),
                env: {
                    ...process.env,
                    CIRCUITJSON_BENCHMARK_PACKAGE_ROOT: emptyPackage,
                    CIRCUITJSON_BENCHMARK_PACKAGE_VERSION: '1.1.0',
                    CIRCUITJSON_BENCHMARK_SOURCE_DIGEST: 'a'.repeat(64)
                }
            }
        ),
        /Cannot find module|ERR_MODULE_NOT_FOUND/u
    )
})

test('benchmark comparison enforces timing and clone release gates', async () => {
    const baseline = await readJson('benchmarks/baseline-v1.0.17.json')
    const current = passingCurrentReport(baseline)

    const accepted = compareBenchmarkReports(current, baseline)
    assert.equal(accepted.passed, true)
    assert.equal(
        accepted.gates.every((gate) => gate.passed),
        true
    )

    current.cases[0] = structuredClone(baseline.cases[0])
    scaleSamples(current.cases[0], 0.81)
    current.cases[0].processCount = 3
    current.cases[0].processMedians = new Array(3).fill(
        current.cases[0].medianMilliseconds
    )
    const rejected = compareBenchmarkReports(current, baseline)
    assert.equal(rejected.passed, false)
    assert.match(rejected.failures[0], /parse-context-50000/u)
})

test('comparison rejects every internally rechecksummed historical mutation', async () => {
    const original = await readJson('benchmarks/baseline-v1.0.17.json')
    const current = passingCurrentReport(original)
    const mutations = [
        [
            'samples and median',
            (report) => {
                report.cases[0].samples.fill(1_000_000)
                report.cases[0].medianMilliseconds = 1_000_000
            }
        ],
        [
            'provenance',
            (report) => {
                report.provenance.sourceCommit = 'f'.repeat(40)
                report.provenance.sourceTree = 'e'.repeat(40)
            }
        ],
        [
            'environment',
            (report) => {
                report.environment = {
                    node: 'v99.0.0',
                    platform: 'forged',
                    architecture: 'forged',
                    cpu: 'forged',
                    logicalCpuCount: 1
                }
            }
        ],
        [
            'retained heap',
            (report) => {
                report.cases[0].retainedHeap.beforeBytes = 10
                report.cases[0].retainedHeap.afterBytes = 20
                report.cases[0].retainedHeap.retainedBytes = 10
            }
        ],
        ['clone bytes', (report) => (report.cases[1].cloneBytes += 1)]
    ]

    for (const [name, mutate] of mutations) {
        const baseline = structuredClone(original)
        mutate(baseline)
        rechecksum(baseline)
        assert.throws(
            () => compareBenchmarkReports(current, baseline),
            /approved versioned contract/u,
            name
        )
    }
})

test('comparison validates current measurements, provenance, and case identity', async () => {
    const baseline = await readJson('benchmarks/baseline-v1.0.17.json')
    const mutations = [
        [
            'sample internals',
            (report) => (report.cases[2].samples[0] = Number.NaN)
        ],
        [
            'provenance',
            (report) => (report.provenance.sourceTree = 'f'.repeat(40))
        ],
        [
            'heap internals',
            (report) => (report.cases[2].retainedHeap.retainedBytes += 1)
        ],
        ['clone internals', (report) => (report.cases[2].cloneBytes = -1)],
        [
            'duplicate case id',
            (report) => (report.cases[1].id = report.cases[0].id)
        ],
        [
            'candidate provenance',
            (report) => (report.candidateProvenance.tarballSha256 = 'bad')
        ],
        [
            'candidate execution',
            (report) => (report.execution.sourceDigest = 'd'.repeat(64))
        ],
        [
            'process evidence',
            (report) => {
                report.cases[0].processCount = 1
                report.cases[0].processMedians.length = 1
            }
        ]
    ]

    for (const [name, mutate] of mutations) {
        const current = passingCurrentReport(baseline)
        mutate(current)
        assert.throws(
            () => compareBenchmarkReports(current, baseline),
            /current benchmark report|current benchmark case/iu,
            name
        )
    }
})

test('compare paths reject symlinks whose real target is outside the repository', async (context) => {
    const outside = await mkdtemp(join(tmpdir(), 'circuitjson-compare-link-'))
    const target = join(outside, 'baseline.json')
    const relativeLink = `benchmarks/.outside-compare-${process.pid}.json`
    const link = new URL(relativeLink, repositoryRoot)
    await writeFile(
        target,
        await readFile(
            new URL('benchmarks/baseline-v1.0.17.json', repositoryRoot)
        )
    )
    await symlink(target, link)
    context.after(() => rm(outside, { recursive: true, force: true }))
    context.after(() => rm(link, { force: true }))

    await assert.rejects(
        () => runBenchmarks(['--compare', relativeLink]),
        /--compare path resolves outside the repository/u
    )
})

test('output paths reject symlinked parents outside the repository', async (context) => {
    const outside = await mkdtemp(join(tmpdir(), 'circuitjson-output-link-'))
    const relativeDirectory = `benchmarks/.outside-output-${process.pid}`
    const link = new URL(relativeDirectory, repositoryRoot)
    await symlink(outside, link, 'dir')
    context.after(() => rm(outside, { recursive: true, force: true }))
    context.after(() => rm(link, { force: true }))

    await assert.rejects(
        () => runBenchmarks(['--output', `${relativeDirectory}/report.json`]),
        /--output path resolves outside the repository/u
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
    const interaction = PcbInteractionIndex.create(document)
    let candidateCount = 0
    for (let index = 0; index < workload.iterations; index += 1) {
        candidateCount += interaction.hitTest(
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
    assert.equal(interaction.statistics.primitiveBuilds, 1)
    assert.equal(interaction.statistics.spatialIndexBuilds, 1)
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
