import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { promisify } from 'node:util'
import { format } from 'prettier'

import { BenchmarkCaseCatalog } from '../benchmarks/BenchmarkCaseCatalog.mjs'
import { CircuitJsonBenchmarkSuite } from '../benchmarks/CircuitJsonBenchmarkSuite.mjs'
import {
    BaselineProvenance,
    ImmutableBaselineWriter
} from './BaselineArtifacts.mjs'
import { FreshPackageCandidate } from './FreshPackageCandidate.mjs'

const repositoryRoot = new URL('../', import.meta.url)
const execFileAsync = promisify(execFile)
const CANDIDATE_PROCESS_COUNT = 3
const DEFAULT_COMPARISON_PATH = 'benchmarks/baseline-v1.0.17.json'
const APPROVED_BASELINE_REPORT_CHECKSUM =
    '734cc40ba998efd9ae3f686a5825e9ceaad4034938ca530156879053a3394140'
const APPROVED_BASELINE_IDENTITY = Object.freeze({
    schema: 'circuitjson-toolkit.benchmark.v1',
    packageVersion: '1.0.17',
    provenance: Object.freeze({
        sourceCommit: '8c9d7deb0229d7d7d8d2f7bdcd621933e88753f9',
        sourceTree: '6740d0a6d8a1c0db3da7423c6595b8231d392f0d'
    }),
    environment: Object.freeze({
        node: 'v20.17.0',
        platform: 'darwin',
        architecture: 'arm64',
        cpu: 'Apple M3 Max',
        logicalCpuCount: 16
    }),
    caseCatalogChecksum:
        'aa5a3a80cd4d8c3a3b40cffb53a750673076c17108ce2e9764de1fc82e8fe05e',
    measurementContract: Object.freeze({
        clonePhase: 'after-workload',
        median: 'sorted-middle-six-decimal',
        retainedBytes: 'max(0,afterBytes-beforeBytes)'
    }),
    fixtureChecksum:
        '76b9f8d819bdff0c0a08080e9891c5a7f2717b8151c77eff836a1112027990a5'
})

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
    return resolveReportPath(recordPath, '--record', root)
}

/**
 * Resolves one repository-confined benchmark artifact path.
 * @param {string} reportPath Requested artifact path.
 * @param {string} flag Command-line flag owning the path.
 * @param {string | URL} [root] Repository root.
 * @returns {string} Absolute output path.
 */
function resolveReportPath(reportPath, flag, root = repositoryRoot) {
    const rootPath = resolve(
        root instanceof URL ? fileURLToPath(root) : String(root)
    )
    if (!reportPath || isAbsolute(reportPath)) {
        throw new Error(
            `${flag} requires a repository-relative path inside the repository.`
        )
    }
    const outputPath = resolve(rootPath, reportPath)
    const relativePath = relative(rootPath, outputPath)
    if (
        relativePath === '..' ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
    ) {
        throw new Error(
            `${flag} requires a repository-relative path inside the repository.`
        )
    }
    return outputPath
}

/**
 * Resolves and validates an existing repository-confined report target.
 * @param {string} reportPath Requested repository-relative path.
 * @param {string} flag Command-line flag owning the path.
 * @param {string | URL} [root] Repository root.
 * @returns {Promise<string>} Canonical readable target.
 */
export async function resolveReadableReportPath(
    reportPath,
    flag,
    root = repositoryRoot
) {
    const rootPath = resolveRootPath(root)
    const candidate = resolveReportPath(reportPath, flag, rootPath)
    const [canonicalRoot, canonicalTarget] = await Promise.all([
        realpath(rootPath),
        realpath(candidate)
    ])
    assertCanonicalContainment(canonicalRoot, canonicalTarget, flag)
    return canonicalTarget
}

/**
 * Resolves and validates a repository-confined writable report target.
 * @param {string} reportPath Requested repository-relative path.
 * @param {string} flag Command-line flag owning the path.
 * @param {string | URL} [root] Repository root.
 * @returns {Promise<string>} Lexical writable target after canonical checks.
 */
export async function resolveWritableReportPath(
    reportPath,
    flag,
    root = repositoryRoot
) {
    const rootPath = resolveRootPath(root)
    const candidate = resolveReportPath(reportPath, flag, rootPath)
    const canonicalRoot = await realpath(rootPath)
    let exists = true
    try {
        await lstat(candidate)
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        exists = false
    }
    const canonicalBoundary = exists
        ? await realpath(candidate)
        : await realpath(dirname(candidate))
    assertCanonicalContainment(canonicalRoot, canonicalBoundary, flag)
    return candidate
}

/**
 * Converts one repository root input to an absolute lexical path.
 * @param {string | URL} root Repository root input.
 * @returns {string} Absolute root path.
 */
function resolveRootPath(root) {
    return resolve(root instanceof URL ? fileURLToPath(root) : String(root))
}

/**
 * Rejects canonical paths outside the canonical repository root.
 * @param {string} canonicalRoot Canonical repository root.
 * @param {string} canonicalTarget Canonical target or parent path.
 * @param {string} flag Command-line flag owning the path.
 * @returns {void}
 */
function assertCanonicalContainment(canonicalRoot, canonicalTarget, flag) {
    const relationship = relative(canonicalRoot, canonicalTarget)
    if (
        relationship === '..' ||
        relationship.startsWith(`..${sep}`) ||
        isAbsolute(relationship)
    ) {
        throw new Error(`${flag} path resolves outside the repository.`)
    }
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
 * Verifies the independently approved historical benchmark identity.
 * @param {Record<string, any>} report Existing report.
 * @returns {void}
 */
export function validateExistingBaseline(report) {
    const catalog = BenchmarkCaseCatalog.load()
    const { reportChecksum, ...reportBody } = report
    const cases = Array.isArray(report.cases) ? report.cases : []
    const identity = benchmarkIdentity(report)
    if (
        reportChecksum !== APPROVED_BASELINE_REPORT_CHECKSUM ||
        !isDeepStrictEqual(identity, APPROVED_BASELINE_IDENTITY) ||
        catalog.packageVersion !== APPROVED_BASELINE_IDENTITY.packageVersion ||
        catalog.catalogChecksum !==
            APPROVED_BASELINE_IDENTITY.caseCatalogChecksum ||
        !isDeepStrictEqual(caseContracts(cases, true), catalog.cases) ||
        !validCaseCollection(cases) ||
        reportChecksum !== benchmarkChecksum(reportBody)
    ) {
        throw new Error(
            'Existing benchmark baseline differs from the approved versioned contract.'
        )
    }
}

/**
 * Verifies one current report before applying performance gates.
 * @param {Record<string, any>} current Current report body.
 * @param {Record<string, any>} baseline Approved baseline.
 * @returns {void}
 */
function validateCurrentReport(current, baseline) {
    const cases = Array.isArray(current.cases) ? current.cases : []
    const identity = benchmarkIdentity(current)
    const expectedIdentity = {
        ...APPROVED_BASELINE_IDENTITY,
        packageVersion: String(current.packageVersion || '')
    }
    const ids = cases.map((entry) => entry?.id)
    if (
        !identity.packageVersion ||
        identity.packageVersion === baseline.packageVersion ||
        !isDeepStrictEqual(identity, expectedIdentity) ||
        !validCandidateProvenance(
            current.candidateProvenance,
            current.packageVersion
        ) ||
        !validCandidateExecution(
            current.execution,
            current.candidateProvenance
        ) ||
        cases.length !== baseline.cases.length ||
        new Set(ids).size !== cases.length ||
        !validCaseCollection(cases) ||
        !cases.every((entry) => validCandidateProcessEvidence(entry))
    ) {
        throw new Error(
            'Current benchmark report has invalid identity or measurements.'
        )
    }
}

/**
 * Verifies that timings came from the extracted package identified by the
 * candidate provenance rather than the live benchmark harness worktree.
 * @param {unknown} value Benchmark execution marker.
 * @param {unknown} provenance Candidate provenance.
 * @returns {boolean} Whether the execution target and identity reconcile.
 */
function validCandidateExecution(value, provenance) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        value.schema === 'ecad-toolkit.benchmark-execution.v1' &&
        value.target === 'packed-candidate' &&
        value.packageVersion === provenance?.packageVersion &&
        value.sourceDigest === provenance?.sourceDigest
    )
}

/**
 * Verifies live source and tarball identity on a candidate benchmark report.
 * @param {unknown} value Candidate provenance.
 * @param {unknown} packageVersion Current package version.
 * @returns {boolean} Whether provenance is complete.
 */
function validCandidateProvenance(value, packageVersion) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        value.schema === 'ecad-toolkit.candidate-provenance.v1' &&
        value.packageName === 'circuitjson-toolkit' &&
        value.packageVersion === packageVersion &&
        /^[a-f0-9]{40}$/u.test(value.sourceCommit) &&
        /^[a-f0-9]{64}$/u.test(value.sourceDigest) &&
        /^[a-f0-9]{64}$/u.test(value.tarballSha256)
    )
}

/**
 * Verifies independent-process timing evidence for one candidate case.
 * @param {Record<string, any>} entry Benchmark case.
 * @returns {boolean} Whether at least three process medians reconcile.
 */
function validCandidateProcessEvidence(entry) {
    const medians = Array.isArray(entry.processMedians)
        ? entry.processMedians
        : []
    return (
        Number.isInteger(entry.processCount) &&
        entry.processCount >= CANDIDATE_PROCESS_COUNT &&
        medians.length === entry.processCount &&
        medians.every((value) => Number.isFinite(value) && value >= 0) &&
        entry.medianMilliseconds === median(medians)
    )
}

/**
 * Selects immutable report identity fields.
 * @param {Record<string, any>} report Benchmark report.
 * @returns {Record<string, any>} Comparable report identity.
 */
function benchmarkIdentity(report) {
    return {
        schema: report.schema,
        packageVersion: report.packageVersion,
        provenance: report.provenance,
        environment: report.environment,
        caseCatalogChecksum: report.caseCatalogChecksum,
        measurementContract: report.measurementContract,
        fixtureChecksum: report.fixtureChecksum
    }
}

/**
 * Selects case workload contracts in catalog shape.
 * @param {Record<string, any>[]} cases Benchmark case reports.
 * @param {boolean} includeClone Whether approved clone bytes are required.
 * @returns {Record<string, any>[]} Comparable case contracts.
 */
function caseContracts(cases, includeClone) {
    return cases.map((entry) => ({
        id: entry.id,
        primary: entry.primary,
        warmups: entry.warmups,
        sampleCount: entry.sampleCount,
        workload: entry.workload,
        cloneTarget: entry.cloneTarget,
        expectedResult: entry.expectedResult,
        ...(includeClone ? { expectedCloneBytes: entry.cloneBytes } : {})
    }))
}

/**
 * Verifies unique ids and all measurement internals in one case array.
 * @param {Record<string, any>[]} cases Benchmark case reports.
 * @returns {boolean} Whether the complete case collection is valid.
 */
function validCaseCollection(cases) {
    const ids = cases.map((entry) => entry?.id)
    return (
        cases.length > 0 &&
        new Set(ids).size === cases.length &&
        ids.every((id) => typeof id === 'string' && id.length > 0) &&
        cases.every((entry) => validateCaseMeasurement(entry))
    )
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
        Number.isInteger(entry.cloneBytes) &&
        entry.cloneBytes >= 0 &&
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
 * Compares one current report with the immutable baseline release gates.
 * @param {Record<string, any>} current Current package benchmark report.
 * @param {Record<string, any>} baseline Immutable baseline report.
 * @returns {{ schema: string, packageVersion: string, baselinePackageVersion: string, baselineReportChecksum: string, passed: boolean, gates: object[], failures: string[] }} Comparison evidence.
 */
export function compareBenchmarkReports(current, baseline) {
    validateExistingBaseline(baseline)
    validateCurrentReport(current, baseline)
    const currentCases = new Map(
        (Array.isArray(current.cases) ? current.cases : []).map((entry) => [
            entry.id,
            entry
        ])
    )
    const baselineCases = Array.isArray(baseline.cases) ? baseline.cases : []
    if (currentCases.size !== baselineCases.length) {
        throw new Error(
            'Current benchmark report differs from the frozen comparison contract.'
        )
    }

    const gates = []
    for (const baselineCase of baselineCases) {
        const currentCase = currentCases.get(baselineCase.id)
        if (!currentCase || !sameCaseContract(currentCase, baselineCase)) {
            throw new Error(
                `Current benchmark case differs from the frozen contract: ${baselineCase.id}.`
            )
        }
        const factor = baselineCase.primary
            ? 0.8
            : baselineCase.medianMilliseconds >= 1
              ? 1.05
              : 1.1
        const limit = baselineCase.medianMilliseconds * factor
        gates.push(
            benchmarkGate({
                baseline: baselineCase.medianMilliseconds,
                current: currentCase.medianMilliseconds,
                id: baselineCase.id,
                kind: baselineCase.primary
                    ? 'primary-time-improvement'
                    : factor === 1.05
                      ? 'large-case-time-regression'
                      : 'small-case-time-regression',
                limit,
                requirement: baselineCase.primary
                    ? 'at least 20% faster'
                    : factor === 1.05
                      ? 'at most 5% slower'
                      : 'at most 10% slower'
            })
        )
    }

    const baselineClone = baselineCases.find(
        (entry) => entry.id === 'context-reuse'
    )
    const currentClone = currentCases.get('context-reuse')
    if (!baselineClone || !currentClone) {
        throw new Error(
            'Benchmark comparison requires the context-reuse clone case.'
        )
    }
    gates.push(
        benchmarkGate({
            baseline: baselineClone.cloneBytes,
            current: currentClone.cloneBytes,
            id: 'context-reuse',
            kind: 'duplicate-graph-clone-reduction',
            limit: baselineClone.cloneBytes * 0.75,
            requirement: 'at least 25% smaller'
        })
    )
    const failures = gates
        .filter((gate) => !gate.passed)
        .map(
            (gate) =>
                `${gate.id} ${gate.kind} requires ${gate.requirement}; ` +
                `measured ${gate.current} with limit ${gate.limit}.`
        )
    return {
        schema: 'circuitjson-toolkit.benchmark-comparison.v1',
        packageVersion: String(current.packageVersion || ''),
        baselinePackageVersion: String(baseline.packageVersion || ''),
        baselineReportChecksum: String(baseline.reportChecksum || ''),
        passed: failures.length === 0,
        gates,
        failures
    }
}

/**
 * Checks immutable workload fields for one current case.
 * @param {Record<string, any>} current Current case.
 * @param {Record<string, any>} baseline Baseline case.
 * @returns {boolean} Whether workload semantics match.
 */
function sameCaseContract(current, baseline) {
    return isDeepStrictEqual(
        {
            id: current.id,
            primary: current.primary,
            warmups: current.warmups,
            sampleCount: current.sampleCount,
            workload: current.workload,
            cloneTarget: current.cloneTarget,
            expectedResult: current.expectedResult
        },
        {
            id: baseline.id,
            primary: baseline.primary,
            warmups: baseline.warmups,
            sampleCount: baseline.sampleCount,
            workload: baseline.workload,
            cloneTarget: baseline.cloneTarget,
            expectedResult: baseline.expectedResult
        }
    )
}

/**
 * Creates one stable numeric comparison gate.
 * @param {{ baseline: number, current: number, id: string, kind: string, limit: number, requirement: string }} input Gate inputs.
 * @returns {Record<string, any>} Comparison gate.
 */
function benchmarkGate(input) {
    const limit = Number(input.limit.toFixed(6))
    const current = Number(input.current)
    const baseline = Number(input.baseline)
    return {
        id: input.id,
        kind: input.kind,
        requirement: input.requirement,
        baseline,
        current,
        limit,
        changePercent: Number(
            (((current - baseline) / baseline) * 100).toFixed(6)
        ),
        passed: Number.isFinite(current) && current <= limit
    }
}

/**
 * Runs the benchmark suite in independent Node processes.
 * @param {{ packageRoot: string, provenance: Record<string, any> }} candidate Extracted package candidate.
 * @returns {Promise<Record<string, any>[]>} Independent reports.
 */
async function independentProcessReports(candidate) {
    const reports = []
    const script = fileURLToPath(import.meta.url)
    for (let index = 0; index < CANDIDATE_PROCESS_COUNT; index += 1) {
        const { stdout, stderr } = await execFileAsync(
            process.execPath,
            ['--expose-gc', script, '--sample-process'],
            {
                cwd: fileURLToPath(repositoryRoot),
                env: {
                    ...process.env,
                    CIRCUITJSON_BENCHMARK_PACKAGE_ROOT: candidate.packageRoot,
                    CIRCUITJSON_BENCHMARK_PACKAGE_VERSION:
                        candidate.provenance.packageVersion,
                    CIRCUITJSON_BENCHMARK_SOURCE_DIGEST:
                        candidate.provenance.sourceDigest
                },
                maxBuffer: 20 * 1024 * 1024
            }
        )
        if (stderr) throw new Error(stderr)
        reports.push(JSON.parse(stdout))
    }
    return reports
}

/**
 * Aggregates the median independent process while retaining every process
 * median as release evidence.
 * @param {Record<string, any>[]} reports Independent reports.
 * @returns {Record<string, any>} Robust candidate report body.
 */
function aggregateProcessReports(reports) {
    if (reports.length < CANDIDATE_PROCESS_COUNT) {
        throw new Error('Candidate benchmarks require three processes.')
    }
    const first = reports[0]
    const cases = first.cases.map((firstCase, caseIndex) => {
        const processCases = reports.map((report) => {
            if (
                !isDeepStrictEqual(
                    benchmarkIdentity(report),
                    benchmarkIdentity(first)
                ) ||
                !isDeepStrictEqual(report.execution, first.execution)
            ) {
                throw new Error(
                    'Candidate benchmark process identity changed between runs.'
                )
            }
            const candidate = report.cases?.[caseIndex]
            if (
                !candidate ||
                !sameCaseContract(candidate, firstCase) ||
                !validateCaseMeasurement(candidate)
            ) {
                throw new Error(
                    `Candidate benchmark process case is invalid: ${firstCase.id}.`
                )
            }
            return candidate
        })
        const ordered = [...processCases].sort(
            (left, right) => left.medianMilliseconds - right.medianMilliseconds
        )
        const representative = ordered[Math.floor(ordered.length / 2)]
        const processMedians = processCases.map(
            (entry) => entry.medianMilliseconds
        )
        return {
            ...representative,
            processCount: processCases.length,
            processMedians,
            medianMilliseconds: median(processMedians)
        }
    })
    return { ...first, cases }
}

/**
 * Runs the frozen benchmark suite and optionally records its report.
 * @param {string[]} args Command-line arguments.
 * @returns {Promise<Record<string, any>>} Benchmark report.
 */
export async function runBenchmarks(args = process.argv.slice(2)) {
    const recordPath = flagValue(args, '--record')
    const explicitComparePath = flagValue(args, '--compare')
    const comparePath =
        explicitComparePath ||
        (!recordPath && !args.includes('--sample-process')
            ? DEFAULT_COMPARISON_PATH
            : '')
    const resultPath = flagValue(args, '--output')
    if (args.includes('--record') && recordPath.length === 0) {
        throw new Error(
            '--record requires a repository-relative path inside the repository.'
        )
    }
    for (const [flag, value] of [
        ['--compare', comparePath],
        ['--output', resultPath]
    ]) {
        if (args.includes(flag) && value.length === 0) {
            throw new Error(`${flag} requires a repository-relative path.`)
        }
    }
    if (recordPath && resultPath) {
        throw new Error('--record and --output cannot be used together.')
    }
    const outputPath = recordPath
        ? await resolveWritableReportPath(recordPath, '--record')
        : ''
    const comparisonInputPath = comparePath
        ? await resolveReadableReportPath(comparePath, '--compare')
        : ''
    const resultOutputPath = resultPath
        ? await resolveWritableReportPath(resultPath, '--output')
        : ''
    const version = args.includes('--sample-process')
        ? String(
              process.env.CIRCUITJSON_BENCHMARK_PACKAGE_VERSION ||
                  (await packageVersion())
          )
        : await packageVersion()
    const provenance = await BaselineProvenance.capture(repositoryRoot)
    if (args.includes('--sample-process')) {
        return CircuitJsonBenchmarkSuite.run({
            packageVersion: version,
            provenance
        })
    }
    if (outputPath) {
        const existing = await readExistingBaseline(outputPath)
        if (existing) {
            validateExistingBaseline(existing)
            return existing
        }
    }
    const historical = version === APPROVED_BASELINE_IDENTITY.packageVersion
    const candidate = historical
        ? null
        : await FreshPackageCandidate.create(fileURLToPath(repositoryRoot))
    try {
        let reportBody = historical
            ? CircuitJsonBenchmarkSuite.run({
                  packageVersion: version,
                  provenance
              })
            : {
                  ...aggregateProcessReports(
                      await independentProcessReports(candidate)
                  ),
                  candidateProvenance: candidate.provenance
              }
        if (comparisonInputPath) {
            const baseline = await readExistingBaseline(comparisonInputPath)
            if (!baseline) {
                throw new Error(
                    `Benchmark comparison baseline is missing: ${comparePath}.`
                )
            }
            const comparison = compareBenchmarkReports(reportBody, baseline)
            if (!comparison.passed) {
                throw new Error(
                    'Benchmark comparison failed:\n' +
                        comparison.failures.join('\n')
                )
            }
            reportBody = { ...reportBody, comparison }
        }
        const report = {
            ...reportBody,
            reportChecksum: benchmarkChecksum(reportBody)
        }
        if (recordPath) {
            await ImmutableBaselineWriter.writeJson(outputPath, report)
        }
        if (resultOutputPath) {
            await writeFile(
                resultOutputPath,
                await format(JSON.stringify(report), {
                    parser: 'json',
                    tabWidth: 4,
                    trailingComma: 'none'
                })
            )
        }
        return report
    } finally {
        await candidate?.cleanup()
    }
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
