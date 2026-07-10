import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { BenchmarkCaseCatalog } from '../benchmarks/BenchmarkCaseCatalog.mjs'
import { CircuitJsonBenchmarkSuite } from '../benchmarks/CircuitJsonBenchmarkSuite.mjs'
import {
    BaselineProvenance,
    ImmutableBaselineWriter
} from './BaselineArtifacts.mjs'

const repositoryRoot = new URL('../', import.meta.url)

/**
 * Reads the current package version.
 * @returns {Promise<string>} Package version.
 */
async function packageVersion() {
    const pkg = JSON.parse(
        await readFile(new URL('package.json', repositoryRoot), 'utf8')
    )
    return String(pkg.version)
}

/**
 * Returns the value following one command-line flag.
 * @param {string[]} args Command-line arguments.
 * @param {string} flag Flag name.
 * @returns {string} Flag value or an empty string.
 */
function flagValue(args, flag) {
    const index = args.indexOf(flag)
    return index >= 0 ? String(args[index + 1] || '') : ''
}

/**
 * Resolves a repository-confined relative benchmark record path.
 * @param {string} recordPath Requested output path.
 * @param {string | URL} [root] Repository root.
 * @returns {string} Absolute output path.
 */
export function resolveRecordPath(recordPath, root = repositoryRoot) {
    const rootPath = resolve(
        root instanceof URL ? fileURLToPath(root) : String(root)
    )
    if (!recordPath || isAbsolute(recordPath)) {
        throw new Error(
            '--record requires a repository-relative path inside the repository.'
        )
    }
    const outputPath = resolve(rootPath, recordPath)
    const relativePath = relative(rootPath, outputPath)
    if (
        relativePath === '..' ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
    ) {
        throw new Error(
            '--record requires a repository-relative path inside the repository.'
        )
    }
    return outputPath
}

/**
 * Reads an existing benchmark baseline when present.
 * @param {string} path Baseline path.
 * @returns {Promise<Record<string, any> | null>} Existing report or null.
 */
async function readExistingBaseline(path) {
    try {
        return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
    }
}

/**
 * Verifies immutable benchmark identity before accepting an existing record.
 * @param {Record<string, any>} report Existing report.
 * @param {string} version Expected package version.
 * @param {{ sourceCommit: string, sourceTree: string }} provenance Expected provenance.
 * @returns {void}
 */
export function validateExistingBaseline(report, version, provenance) {
    const catalog = BenchmarkCaseCatalog.load()
    const { reportChecksum, ...reportBody } = report
    const cases = Array.isArray(report.cases) ? report.cases : []
    const caseContracts = cases.map((entry) => ({
        id: entry.id,
        primary: entry.primary,
        warmups: entry.warmups,
        sampleCount: entry.sampleCount,
        workload: entry.workload,
        cloneTarget: entry.cloneTarget,
        expectedResult: entry.expectedResult,
        expectedCloneBytes: entry.cloneBytes
    }))
    const measurementsValid = cases.every((entry) =>
        validateCaseMeasurement(entry)
    )
    if (
        report.schema !== 'circuitjson-toolkit.benchmark.v1' ||
        report.packageVersion !== version ||
        catalog.packageVersion !== version ||
        !isDeepStrictEqual(report.provenance, provenance) ||
        report.caseCatalogChecksum !== catalog.catalogChecksum ||
        !isDeepStrictEqual(report.measurementContract, catalog.measurement) ||
        report.fixtureChecksum !== catalog.fixture.checksum ||
        !isDeepStrictEqual(caseContracts, catalog.cases) ||
        !measurementsValid ||
        reportChecksum !== benchmarkChecksum(reportBody)
    ) {
        throw new Error(
            'Existing benchmark baseline differs from the approved versioned contract.'
        )
    }
}

/**
 * Verifies one benchmark measurement against its internally derived values.
 * @param {Record<string, any>} entry Benchmark case report.
 * @returns {boolean} True when samples and retained memory reconcile exactly.
 */
function validateCaseMeasurement(entry) {
    const samples = Array.isArray(entry.samples) ? entry.samples : []
    const retainedHeap = entry.retainedHeap || {}
    const memoryValues = [retainedHeap.beforeBytes, retainedHeap.afterBytes]
    return (
        Number.isInteger(entry.sampleCount) &&
        entry.sampleCount > 0 &&
        samples.length === entry.sampleCount &&
        samples.every((sample) => Number.isFinite(sample) && sample >= 0) &&
        entry.medianMilliseconds === median(samples) &&
        retainedHeap.gcControlled === true &&
        memoryValues.every((value) => Number.isInteger(value) && value >= 0) &&
        retainedHeap.retainedBytes ===
            Math.max(0, retainedHeap.afterBytes - retainedHeap.beforeBytes)
    )
}

/**
 * Returns the stable six-decimal median used by benchmark reports.
 * @param {number[]} samples Timing samples.
 * @returns {number} Median sample.
 */
function median(samples) {
    if (samples.length === 0) return Number.NaN
    const sorted = [...samples].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1
        ? sorted[middle]
        : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(6))
}

/**
 * Hashes a benchmark report body for immutable readback validation.
 * @param {Record<string, any>} report Report without reportChecksum.
 * @returns {string} SHA-256 checksum.
 */
export function benchmarkChecksum(report) {
    return createHash('sha256').update(JSON.stringify(report)).digest('hex')
}

/**
 * Runs the frozen benchmark suite and optionally records its report.
 * @param {string[]} args Command-line arguments.
 * @returns {Promise<Record<string, any>>} Benchmark report.
 */
export async function runBenchmarks(args = process.argv.slice(2)) {
    const recordPath = flagValue(args, '--record')
    if (args.includes('--record') && recordPath.length === 0) {
        throw new Error(
            '--record requires a repository-relative path inside the repository.'
        )
    }
    const version = await packageVersion()
    const provenance = await BaselineProvenance.capture(repositoryRoot)
    const outputPath = recordPath ? resolveRecordPath(recordPath) : ''
    if (outputPath) {
        const existing = await readExistingBaseline(outputPath)
        if (existing) {
            validateExistingBaseline(existing, version, provenance)
            return existing
        }
    }
    const reportBody = CircuitJsonBenchmarkSuite.run({
        packageVersion: version,
        provenance
    })
    const report = {
        ...reportBody,
        reportChecksum: benchmarkChecksum(reportBody)
    }
    if (recordPath) {
        await ImmutableBaselineWriter.writeJson(outputPath, report)
    }
    return report
}

/**
 * Returns whether this module is the active Node entry script.
 * @returns {boolean} True for direct command-line execution.
 */
function isMain() {
    return Boolean(
        process.argv[1] &&
        pathToFileURL(process.argv[1]).href === import.meta.url
    )
}

if (isMain()) {
    const report = await runBenchmarks()
    process.stdout.write(JSON.stringify(report, null, 4) + '\n')
}
