import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { FreshPackageCandidate } from './FreshPackageCandidate.mjs'

const EXEC_FILE = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Creates an isolated packed-install fixture without running package scripts.
 * @param {string} tarball Absolute tarball path.
 * @returns {Promise<string>} Fixture directory.
 */
async function installFixture(tarball) {
    await readFile(tarball)
    const fixture = await mkdtemp(resolve(tmpdir(), 'circuitjson-packed-'))
    await writeFile(
        resolve(fixture, 'package.json'),
        `${JSON.stringify(
            {
                name: 'circuitjson-packed-entrypoint-check',
                private: true,
                type: 'module'
            },
            null,
            4
        )}\n`
    )
    await EXEC_FILE(
        process.env.npm_execpath || 'npm',
        [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--package-lock=false',
            tarball
        ],
        { cwd: fixture, env: process.env }
    )
    return fixture
}

/**
 * Returns the standalone packed-package verification program.
 * @returns {string} ESM source.
 */
function verifierSource() {
    return `
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import * as root from 'circuitjson-toolkit'
import * as parser from 'circuitjson-toolkit/parser'
import * as project from 'circuitjson-toolkit/project'
import * as renderers from 'circuitjson-toolkit/renderers'
import * as interaction from 'circuitjson-toolkit/interaction'
import * as query from 'circuitjson-toolkit/query'
import * as manufacturing from 'circuitjson-toolkit/manufacturing'
import * as simulation from 'circuitjson-toolkit/simulation'
import * as scene3d from 'circuitjson-toolkit/scene3d'
import * as capabilities from 'circuitjson-toolkit/capabilities'
import * as extensions from 'circuitjson-toolkit/extensions'
import {
    ToolkitContractFixtures,
    runToolkitContract
} from 'circuitjson-toolkit/testing'

const canonical = ToolkitContractFixtures.canonicalClassNames
const compatibility = ['CircuitJsonDocument', 'CircuitJsonIndexer', 'CircuitJsonUnits']
assert.deepEqual(Object.keys(root).sort(), [...canonical, ...compatibility].sort())
for (const name of [...canonical, ...compatibility]) {
    assert.equal(typeof root[name], 'function', name)
}
const exactSubpaths = [
    [parser, [
        'Parser',
        'CircuitJsonDocumentContext',
        'ToolkitError',
        'DocumentResult',
        'ToolkitDiagnostic',
        'ToolkitAsset',
        'ToolkitProgress',
        'TOOLKIT_WORKER_PROTOCOL',
        'ToolkitWorkerProtocol',
        'ParserWorkerClient'
    ]],
    [project, [
        'ProjectLoader',
        'ProjectResult',
        'ArchiveLimits',
        'ArchiveEntryPath',
        'ZipArchiveInspector'
    ]],
    [renderers, ['PcbSvgRenderer', 'SchematicSvgRenderer', 'BomTableRenderer']],
    [interaction, ['PcbInteractionIndex', 'PcbSpatialIndex']],
    [query, ['QueryService']],
    [manufacturing, ['ManufacturingService']],
    [simulation, ['SimulationService']],
    [scene3d, ['PcbScene3dBuilder', 'PcbScene3dPreparator', 'SceneAssetResolver']],
    [capabilities, ['ToolkitCapabilities']]
]
for (const [namespace, names] of exactSubpaths) {
    assert.deepEqual(Object.keys(namespace).sort(), names.sort())
    for (const name of names) {
        const expectedType = name === 'TOOLKIT_WORKER_PROTOCOL' ? 'string' : 'function'
        assert.equal(typeof namespace[name], expectedType, name)
    }
}
assert.ok(Object.keys(extensions).length > 0)
assert.equal(typeof parser.ParserWorkerClient.prototype.parseAttempt, 'function')
assert.equal(typeof parser.ParserWorkerClient.prototype.loadProjectAttempt, 'function')

const report = await runToolkitContract(root)
assert.equal(report.schema, 'ecad-toolkit.contract-report.v1')
assert.deepEqual(report.failures, [])

const worker = await import('circuitjson-toolkit/workers/parser.worker.mjs')
const styleUrl = import.meta.resolve('circuitjson-toolkit/styles/renderers.css')
assert.equal(typeof worker.installParserWorker, 'function')
assert.deepEqual(Object.keys(worker), ['installParserWorker'])
assert.match(await readFile(new URL(styleUrl), 'utf8'), /\\.pcb-svg/u)

process.stdout.write(JSON.stringify({
    schema: 'ecad-toolkit.contract-report.v1',
    canonicalExports: canonical.length,
    checks: report.checks.length,
    failures: report.failures.length
}) + '\\n')
`
}

/**
 * Installs and validates every public packed entrypoint.
 * @returns {Promise<void>}
 */
async function main() {
    const explicit = process.argv[2]
        ? resolve(process.cwd(), process.argv[2])
        : ''
    const candidate = await FreshPackageCandidate.create(ROOT, explicit)
    const fixture = await installFixture(candidate.tarballPath)
    try {
        const verifier = resolve(fixture, 'verify-packed-entrypoints.mjs')
        await writeFile(verifier, verifierSource())
        const { stdout, stderr } = await EXEC_FILE(
            process.execPath,
            [verifier],
            {
                cwd: fixture,
                env: process.env
            }
        )
        assert.equal(stderr, '')
        process.stdout.write(stdout)
        process.stdout.write(`${JSON.stringify(candidate.provenance)}\n`)
    } finally {
        await rm(fixture, { recursive: true, force: true })
        await candidate.cleanup()
    }
}

await main()
