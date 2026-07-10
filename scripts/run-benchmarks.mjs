import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { CircuitJsonBenchmarkSuite } from '../benchmarks/CircuitJsonBenchmarkSuite.mjs'
import {
    BaselineProvenance,
    ImmutableBaselineWriter
} from './BaselineArtifacts.mjs'

const repositoryRoot = new URL('../', import.meta.url)
const REQUIRED_CASES = [
    { id: 'parse-context-50000', primary: true },
    { id: 'repeated-query-hit-test', primary: true },
    { id: 'repeated-netlist-query', primary: false },
    { id: 'multi-layer-render', primary: false },
    { id: 'context-reuse', primary: false }
]

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
function validateExistingBaseline(report, version, provenance) {
    const { reportChecksum, ...reportBody } = report
    const cases = Array.isArray(report.cases)
        ? report.cases.map(({ id, primary }) => ({ id, primary }))
        : []
    if (
        report.schema !== 'circuitjson-toolkit.benchmark.v1' ||
        report.packageVersion !== version ||
        !isDeepStrictEqual(report.provenance, provenance) ||
        !isDeepStrictEqual(cases, REQUIRED_CASES) ||
        reportChecksum !== benchmarkChecksum(reportBody)
    ) {
        throw new Error(
            'Existing benchmark baseline differs from the approved versioned contract.'
        )
    }
}

/**
 * Hashes a benchmark report body for immutable readback validation.
 * @param {Record<string, any>} report Report without reportChecksum.
 * @returns {string} SHA-256 checksum.
 */
function benchmarkChecksum(report) {
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
