import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { format } from 'prettier'

const execFileAsync = promisify(execFile)
const EXPECTED_SOURCE_COMMIT = '8c9d7deb0229d7d7d8d2f7bdcd621933e88753f9'
const EXPECTED_SOURCE_TREE = '6740d0a6d8a1c0db3da7423c6595b8231d392f0d'

/**
 * Writes versioned JSON artifacts once and rejects later drift.
 */
export class ImmutableBaselineWriter {
    /**
     * Creates an absent baseline, accepts identical content, and rejects differences.
     * @param {string | URL} path Baseline path.
     * @param {unknown} value JSON value.
     * @returns {Promise<'created' | 'identical'>} Write result.
     */
    static async writeJson(path, value) {
        const serialized = await ImmutableBaselineWriter.#serialize(value)
        try {
            const existing = await readFile(path, 'utf8')
            if (existing !== serialized) {
                throw new Error(
                    `Refusing to overwrite immutable baseline: ${String(path)}`
                )
            }
            return 'identical'
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error
            }
        }
        await writeFile(path, serialized, { flag: 'wx' })
        return 'created'
    }

    /**
     * Serializes JSON with repository formatting.
     * @param {unknown} value JSON value.
     * @returns {Promise<string>} Canonical JSON text.
     */
    static async #serialize(value) {
        return format(JSON.stringify(value), {
            parser: 'json',
            tabWidth: 4,
            singleQuote: true,
            semi: false,
            trailingComma: 'none'
        })
    }
}

/**
 * Captures and verifies immutable 1.0.17 source provenance.
 */
export class BaselineProvenance {
    /**
     * Verifies the peeled tag and unchanged current src tree.
     * @param {string | URL} [repositoryRoot] Repository root.
     * @returns {Promise<{ sourceCommit: string, sourceTree: string }>} Verified provenance.
     */
    static async capture(repositoryRoot = new URL('../', import.meta.url)) {
        const root = BaselineProvenance.#rootPath(repositoryRoot)
        const sourceCommit = await BaselineProvenance.#git(
            root,
            'rev-parse',
            'v1.0.17^{}'
        )
        const sourceTree = await BaselineProvenance.#git(
            root,
            'rev-parse',
            `${EXPECTED_SOURCE_COMMIT}:src`
        )
        const headTree = await BaselineProvenance.#git(
            root,
            'rev-parse',
            'HEAD:src'
        )
        const committedChanges = await BaselineProvenance.#git(
            root,
            'diff',
            '--name-only',
            EXPECTED_SOURCE_COMMIT,
            '--',
            'src'
        )
        const workingChanges = await BaselineProvenance.#git(
            root,
            'status',
            '--porcelain',
            '--untracked-files=all',
            '--',
            'src'
        )

        if (
            sourceCommit !== EXPECTED_SOURCE_COMMIT ||
            sourceTree !== EXPECTED_SOURCE_TREE
        ) {
            throw new Error(
                'The peeled v1.0.17 source commit or src tree does not match the approved baseline.'
            )
        }
        if (
            headTree !== sourceTree ||
            committedChanges.length > 0 ||
            workingChanges.length > 0
        ) {
            throw new Error(
                'The current src tree differs from the approved v1.0.17 baseline.'
            )
        }
        return { sourceCommit, sourceTree }
    }

    /**
     * Runs one git command and returns trimmed stdout.
     * @param {string} repositoryRoot Repository root.
     * @param {...string} args Git arguments.
     * @returns {Promise<string>} Trimmed stdout.
     */
    static async #git(repositoryRoot, ...args) {
        const { stdout } = await execFileAsync('git', args, {
            cwd: repositoryRoot,
            maxBuffer: 10 * 1024 * 1024
        })
        return stdout.trim()
    }

    /**
     * Normalizes a repository root to a filesystem path.
     * @param {string | URL} repositoryRoot Repository root.
     * @returns {string} Absolute root path.
     */
    static #rootPath(repositoryRoot) {
        return repositoryRoot instanceof URL
            ? fileURLToPath(repositoryRoot)
            : resolve(String(repositoryRoot))
    }
}
