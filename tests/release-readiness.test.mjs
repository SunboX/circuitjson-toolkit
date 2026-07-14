import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { ToolkitCapabilities } from '../src/core/ToolkitCapabilities.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = new URL('../', import.meta.url)
const migrationPages = [
    'docs/migration/root.md',
    'docs/migration/parser.md',
    'docs/migration/renderers.md',
    'docs/migration/behaviors.md'
]
const replacementPattern =
    /^(circuitjson-toolkit(?:\/(?:parser|project|renderers|interaction|query|manufacturing|simulation|scene3d|capabilities|extensions|testing|workers\/parser\.worker\.mjs))?)#([A-Za-z_$][\w$]*)(?:\.(prototype\.)?([A-Za-z_$][\w$]*)\(\))?$/u

/** @param {string} path Repository-relative path. @returns {Promise<string>} File text. */
async function text(path) {
    return await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

/**
 * @param {string} markdown Markdown document containing pipe tables.
 * @returns {Set<string>} Trimmed first-column values from every table row.
 */
function firstTableColumnValues(markdown) {
    const values = new Set()

    for (const line of markdown.split('\n')) {
        const match = /^\|\s*((?:\\\||[^|])*)\s*\|/u.exec(line)
        if (match) {
            values.add(match[1].trim())
        }
    }

    return values
}

/**
 * Packs and extracts the active release candidate.
 * @param {import('node:test').TestContext} context Node test context.
 * @returns {Promise<string>} Extracted package root.
 */
async function packedCandidate(context) {
    const root = await mkdtemp(join(tmpdir(), 'circuitjson-release-ready-'))
    const { stdout } = await execFileAsync(
        'npm',
        ['pack', '--json', '--pack-destination', root],
        {
            cwd: fileURLToPath(repositoryRoot),
            maxBuffer: 10 * 1024 * 1024
        }
    )
    const filename = JSON.parse(stdout)?.[0]?.filename
    assert.equal(typeof filename, 'string')
    await execFileAsync('tar', ['-xzf', join(root, filename), '-C', root])
    context.after(() => rm(root, { recursive: true, force: true }))
    return join(root, 'package')
}

/**
 * Imports every JavaScript entrypoint from an extracted package.
 * @param {string} packageRoot Extracted package root.
 * @returns {Promise<Map<string, Record<string, any>>>} Modules by export key.
 */
async function packedModules(packageRoot) {
    const pkg = JSON.parse(
        await readFile(join(packageRoot, 'package.json'), 'utf8')
    )
    const modules = new Map()
    for (const [entrypoint, definition] of Object.entries(pkg.exports)) {
        const target =
            typeof definition === 'string'
                ? definition
                : definition.import || definition.default
        if (!/\.(?:c|m)?js$/u.test(target)) continue
        modules.set(
            entrypoint,
            await import(new URL(target, pathToFileURL(`${packageRoot}/`)).href)
        )
    }
    return modules
}

test('release metadata and migration ledger agree', async () => {
    const pkg = JSON.parse(await text('package.json'))
    const ledger = JSON.parse(await text('spec/feature-preservation.json'))
    const migration = await text('docs/migration.md')
    const appendices = await Promise.all(
        migrationPages.map((path) => text(path))
    )
    const capabilities = await text('docs/capabilities.md')
    const releaseNotes = await text('docs/release-notes-v1.1.0.md')
    const patchReleaseNotes = await text('docs/release-notes-v1.1.1.md')
    const rendererPatchReleaseNotes = await text('docs/release-notes-v1.1.2.md')
    const pcbFidelityReleaseNotes = await text('docs/release-notes-v1.2.0.md')
    const projectBoundaryReleaseNotes = await text(
        'docs/release-notes-v1.2.1.md'
    )
    const ownershipPerformanceReleaseNotes = await text(
        'docs/release-notes-v1.3.0.md'
    )
    const readme = await text('README.md')
    const modelFormat = await text('docs/model-format.md')
    const migratedFeatures = firstTableColumnValues(appendices.join('\n'))

    assert.equal(pkg.version, '1.3.0')
    assert.equal(pkg.dependencies, undefined)
    assert.equal(
        ledger.every((row) => {
            const feature = String(row.feature)
                .replaceAll('|', '\\|')
                .replaceAll('\n', '<br>')
            return migratedFeatures.has(feature)
        }),
        true
    )
    assert.equal(
        ToolkitCapabilities.inventory().every((row) =>
            capabilities.includes(`- \`${row.id}\``)
        ),
        true
    )
    assert.match(readme, /Breaking API convergence/u)
    assert.match(readme, /Before 1\.1\.0:/u)
    assert.match(readme, /After 1\.1\.0:/u)
    assert.match(releaseNotes, /Breaking API convergence/u)
    assert.match(releaseNotes, /Before:/u)
    assert.match(releaseNotes, /After:/u)
    assert.match(patchReleaseNotes, /Synchronous queued-request ownership/u)
    assert.match(rendererPatchReleaseNotes, /Deterministic schematic paint/u)
    assert.match(pcbFidelityReleaseNotes, /Canonical PCB fidelity/u)
    assert.match(projectBoundaryReleaseNotes, /Large canonical worker results/u)
    assert.match(
        ownershipPerformanceReleaseNotes,
        /Faster canonical extension ownership/u
    )
    assert.match(
        modelFormat,
        /legacy array[^.]*mutable[^.]*element graph[^.]*deeply immutable/iu
    )
    assert.equal(pkg.files.includes('docs/capabilities.md'), true)
    assert.equal(pkg.files.includes('docs/migration.md'), true)
    assert.equal(pkg.files.includes('docs/migration'), true)
    assert.equal(pkg.files.includes('docs/release-notes-v1.1.0.md'), true)
    assert.equal(pkg.files.includes('docs/release-notes-v1.1.1.md'), true)
    assert.equal(pkg.files.includes('docs/release-notes-v1.1.2.md'), true)
    assert.equal(pkg.files.includes('docs/release-notes-v1.2.0.md'), true)
    assert.equal(pkg.files.includes('docs/release-notes-v1.2.1.md'), true)
    assert.equal(pkg.files.includes('docs/release-notes-v1.3.0.md'), true)
    for (const path of migrationPages) {
        assert.match(migration, new RegExp(path.replace('docs/migration/', '')))
    }
})

test('every migration replacement resolves through exact packed-package grammar', async (context) => {
    const ledger = JSON.parse(await text('spec/feature-preservation.json'))
    const packageRoot = await packedCandidate(context)
    const modules = await packedModules(packageRoot)

    for (const row of ledger) {
        const match = replacementPattern.exec(row.replacement)
        assert.ok(match, `${row.feature}: ${row.replacement}`)
        const [, packageSpecifier, exportName, prototypeMarker, methodName] =
            match
        const entrypoint =
            packageSpecifier === 'circuitjson-toolkit'
                ? '.'
                : `./${packageSpecifier.slice('circuitjson-toolkit/'.length)}`
        const exported = modules.get(entrypoint)?.[exportName]
        assert.notEqual(exported, undefined, row.replacement)
        if (!methodName) continue
        const owner = prototypeMarker ? exported?.prototype : exported
        assert.equal(typeof owner?.[methodName], 'function', row.replacement)
    }
})

test('every release-candidate file stays below the 1000-line limit', async () => {
    const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: fileURLToPath(repositoryRoot), encoding: 'buffer' }
    )
    const paths = stdout.toString('utf8').split('\0').filter(Boolean)
    const violations = []
    for (const path of paths) {
        const contents = await readFile(new URL(path, repositoryRoot))
        let lines = 0
        for (const byte of contents) if (byte === 10) lines += 1
        if (contents.length > 0 && contents.at(-1) !== 10) lines += 1
        if (lines >= 1000) violations.push(`${path}: ${lines}`)
    }
    assert.deepEqual(violations, [])
})

test('release candidate exposes executable packed verification gates', async () => {
    const pkg = JSON.parse(await text('package.json'))

    assert.equal(
        pkg.scripts['check:packed-entrypoints'],
        'node scripts/check-packed-entrypoints.mjs'
    )
    assert.equal(
        pkg.scripts['check:browser-dependencies'],
        'node scripts/check-browser-dependency-graph.mjs'
    )
    assert.equal(
        pkg.scripts.benchmark,
        'node --expose-gc scripts/run-benchmarks.mjs --compare benchmarks/baseline-v1.0.17.json'
    )
    assert.match(
        await text('scripts/run-benchmarks.mjs'),
        /DEFAULT_COMPARISON_PATH\s*=\s*'benchmarks\/baseline-v1\.0\.17\.json'/u
    )
    assert.match(
        await text('scripts/check-packed-entrypoints.mjs'),
        /ecad-toolkit\.contract-report\.v1/u
    )
    assert.match(
        await text('scripts/check-browser-dependency-graph.mjs'),
        /circuit-json/u
    )
})

test('fresh packed schema contract reproduces its pinned contract checksum', async (context) => {
    const packageRoot = await packedCandidate(context)
    const schemaModule = await import(
        new URL(
            './src/core/CircuitJsonUpstreamSchema.mjs',
            pathToFileURL(`${packageRoot}/`)
        ).href
    )
    const source = JSON.parse(
        await readFile(
            join(packageRoot, 'spec/circuitjson-schema-source.json'),
            'utf8'
        )
    )
    const provenance = schemaModule.CIRCUIT_JSON_UPSTREAM_PROVENANCE
    for (const key of [
        'package',
        'version',
        'integrity',
        'distributionFile',
        'distributionSha256',
        'contractSha256'
    ]) {
        assert.equal(provenance[key], source[key], key)
    }
    assert.deepEqual(
        provenance.compilerDependencies,
        source.compilerDependencies
    )
    const contract = {
        schema: schemaModule.CIRCUIT_JSON_UPSTREAM_CONTRACT_SCHEMA,
        elementTypes: schemaModule.CIRCUIT_JSON_UPSTREAM_ELEMENT_TYPES,
        schemas: schemaModule.CIRCUIT_JSON_UPSTREAM_SCHEMAS,
        defaultIdFields: schemaModule.CIRCUIT_JSON_UPSTREAM_DEFAULT_ID_FIELDS,
        idFieldExceptions:
            schemaModule.CIRCUIT_JSON_UPSTREAM_ID_FIELD_EXCEPTIONS,
        variantSets: schemaModule.CIRCUIT_JSON_UPSTREAM_VARIANT_SETS,
        statistics: schemaModule.CIRCUIT_JSON_UPSTREAM_STATISTICS
    }
    assert.equal(
        createHash('sha256').update(JSON.stringify(contract)).digest('hex'),
        source.contractSha256
    )
})
