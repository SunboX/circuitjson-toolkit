import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))
const TEST_ROOT = path.join(PROJECT_ROOT, 'tests')
const ISOLATED_TESTS = Object.freeze([
    'tests/benchmark-contract.test.mjs',
    'tests/extension-ownership-contract.test.mjs',
    'tests/manufacturing-list-exports-performance.test.mjs',
    'tests/scene3d-atomic-boundary-contract.test.mjs',
    'tests/scene3d-final-adversarial-contract.test.mjs',
    'tests/scene3d-rereview-contract.test.mjs'
])
const STARTUP_BENCHMARK_TEST = ISOLATED_TESTS[0]

/**
 * Discovers test modules below one directory without shell-dependent globs.
 * @param {string} directory Absolute directory to inspect.
 * @returns {Promise<string[]>} Repository-relative test module paths.
 */
async function discoverTests(directory) {
    const tests = []
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
            tests.push(...(await discoverTests(absolutePath)))
            continue
        }
        if (!entry.name.endsWith('.test.mjs')) continue
        tests.push(path.relative(PROJECT_ROOT, absolutePath))
    }
    return tests.sort()
}

/**
 * Runs one Node test phase and forwards its exact output and exit status.
 * @param {string[]} args Node test-runner arguments.
 * @returns {void}
 */
function runTests(args) {
    const result = spawnSync(process.execPath, ['--test', ...args], {
        cwd: PROJECT_ROOT,
        stdio: 'inherit'
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
}

const requestedArgs = process.argv.slice(2)
if (requestedArgs.length) {
    runTests(requestedArgs)
} else {
    const tests = await discoverTests(TEST_ROOT)
    runTests([STARTUP_BENCHMARK_TEST])
    runTests(tests.filter((testPath) => !ISOLATED_TESTS.includes(testPath)))
    for (const testPath of ISOLATED_TESTS.slice(1)) runTests([testPath])
}
