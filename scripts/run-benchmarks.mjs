import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { format } from 'prettier'

import { CircuitJsonBenchmarkSuite } from '../benchmarks/CircuitJsonBenchmarkSuite.mjs'

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
 * Runs the frozen benchmark suite and optionally records its report.
 * @param {string[]} args Command-line arguments.
 * @returns {Promise<Record<string, any>>} Benchmark report.
 */
export async function runBenchmarks(args = process.argv.slice(2)) {
    const report = CircuitJsonBenchmarkSuite.run({
        packageVersion: await packageVersion()
    })
    const recordPath = flagValue(args, '--record')
    if (args.includes('--record') && recordPath.length === 0) {
        throw new Error('--record requires a repository-relative output path.')
    }
    if (recordPath) {
        const serialized = await format(JSON.stringify(report), {
            parser: 'json',
            tabWidth: 4,
            singleQuote: true,
            semi: false,
            trailingComma: 'none'
        })
        await writeFile(new URL(recordPath, repositoryRoot), serialized)
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
