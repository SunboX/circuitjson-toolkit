import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { builtinModules, createRequire } from 'node:module'
import {
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { FreshPackageCandidate } from './FreshPackageCandidate.mjs'

const EXEC_FILE = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILTINS = new Set(
    builtinModules.flatMap((name) => [name, name.replace(/^node:/u, '')])
)
const IMPORT_PATTERNS = [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/gu
]

/**
 * Installs the packed candidate into an isolated fixture.
 * @param {string} tarball Candidate tarball.
 * @returns {Promise<string>} Fixture directory.
 */
async function installFixture(tarball) {
    await readFile(tarball)
    const fixture = await mkdtemp(resolve(tmpdir(), 'circuitjson-browser-'))
    await writeFile(
        resolve(fixture, 'package.json'),
        `${JSON.stringify(
            {
                name: 'circuitjson-browser-graph-check',
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
 * Extracts literal ESM dependencies from one JavaScript module.
 * @param {string} source Module source.
 * @returns {string[]} Unique specifiers.
 */
function importSpecifiers(source) {
    const specifiers = new Set()
    for (const pattern of IMPORT_PATTERNS) {
        pattern.lastIndex = 0
        for (const match of source.matchAll(pattern)) specifiers.add(match[1])
    }
    return [...specifiers]
}

/**
 * Resolves a relative browser module with strict packed-file existence.
 * @param {string} owner Importing module.
 * @param {string} specifier Relative import specifier.
 * @returns {Promise<string>} Resolved module path.
 */
async function resolveRelative(owner, specifier) {
    const base = resolve(dirname(owner), specifier)
    const candidates = extname(base)
        ? [base]
        : [base, `${base}.mjs`, `${base}.js`, resolve(base, 'index.mjs')]
    for (const candidate of candidates) {
        try {
            if ((await stat(candidate)).isFile()) return candidate
        } catch {
            // Continue through bounded extension candidates.
        }
    }
    throw new Error(
        `Packed browser dependency is missing: ${owner} -> ${specifier}`
    )
}

/**
 * Returns the package name represented by one bare ESM specifier.
 * @param {string} specifier Bare specifier.
 * @returns {string} Package name.
 */
function packageName(specifier) {
    const parts = specifier.split('/')
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Finds every production browser seed from the packed export map.
 * @param {string} packageRoot Installed package root.
 * @param {Record<string, any>} pkg Installed manifest.
 * @returns {string[]} Absolute JavaScript seed paths.
 */
function exportSeeds(packageRoot, pkg) {
    return Object.values(pkg.exports)
        .map((target) =>
            typeof target === 'string'
                ? target
                : target?.browser || target?.import
        )
        .filter(
            (target) =>
                typeof target === 'string' && /\.(?:m?js|css)$/u.test(target)
        )
        .map((target) => resolve(packageRoot, target))
}

/**
 * Walks reachable packed ESM modules and rejects non-browser/dev-only edges.
 * @param {string} packageRoot Installed package root.
 * @param {Record<string, any>} pkg Installed manifest.
 * @returns {Promise<{ modules: number, externalPackages: string[] }>} Graph summary.
 */
async function inspectGraph(packageRoot, pkg) {
    const queue = exportSeeds(packageRoot, pkg)
    const visited = new Set()
    const externalPackages = new Set()
    const production = new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.optionalDependencies || {}),
        ...Object.keys(pkg.peerDependencies || {})
    ])
    const development = new Set(Object.keys(pkg.devDependencies || {}))

    assert.equal(production.has('circuit-json'), false)
    while (queue.length) {
        const modulePath = queue.shift()
        if (visited.has(modulePath)) continue
        visited.add(modulePath)
        const source = await readFile(modulePath, 'utf8')
        for (const specifier of importSpecifiers(source)) {
            if (specifier.startsWith('.') || specifier.startsWith('/')) {
                queue.push(await resolveRelative(modulePath, specifier))
                continue
            }
            const bareName = packageName(specifier.replace(/^node:/u, ''))
            assert.equal(
                BUILTINS.has(bareName),
                false,
                `Node builtin is reachable from browser export: ${modulePath} -> ${specifier}`
            )
            assert.notEqual(
                bareName,
                'circuit-json',
                `Development-only circuit-json edge is reachable from ${modulePath}`
            )
            assert.equal(
                production.has(bareName),
                true,
                `Undeclared or development-only browser edge: ${modulePath} -> ${specifier}`
            )
            assert.equal(
                development.has(bareName) && !production.has(bareName),
                false,
                `Development-only browser edge: ${modulePath} -> ${specifier}`
            )
            externalPackages.add(bareName)
            const resolved = createRequire(modulePath).resolve(specifier)
            queue.push(resolved)
        }
    }
    return {
        modules: visited.size,
        externalPackages: [...externalPackages].sort()
    }
}

/**
 * Ensures the packed package contains no unexpected runtime package tree.
 * @param {string} fixture Fixture directory.
 * @returns {Promise<void>}
 */
async function assertNoNestedDevelopmentTree(fixture) {
    const nested = resolve(
        fixture,
        'node_modules',
        'circuitjson-toolkit',
        'node_modules'
    )
    try {
        assert.deepEqual(await readdir(nested), [])
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
}

/**
 * Installs and checks the complete packed browser dependency graph.
 * @returns {Promise<void>}
 */
async function main() {
    const explicit = process.argv[2]
        ? resolve(process.cwd(), process.argv[2])
        : ''
    const candidate = await FreshPackageCandidate.create(ROOT, explicit)
    const fixture = await installFixture(candidate.tarballPath)
    try {
        const packageRoot = resolve(
            fixture,
            'node_modules',
            'circuitjson-toolkit'
        )
        const pkg = JSON.parse(
            await readFile(resolve(packageRoot, 'package.json'), 'utf8')
        )
        await assertNoNestedDevelopmentTree(fixture)
        const summary = await inspectGraph(packageRoot, pkg)
        process.stdout.write(
            `${JSON.stringify({
                schema: 'ecad-toolkit.browser-dependency-report.v1',
                candidate: candidate.provenance,
                ...summary
            })}\n`
        )
    } finally {
        await rm(fixture, { recursive: true, force: true })
        await candidate.cleanup()
    }
}

await main()
