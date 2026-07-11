import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Creates and verifies a fresh npm package snapshot for release gates.
 */
export class FreshPackageCandidate {
    /**
     * Packs the live repository and optionally verifies an explicit candidate.
     * @param {string} repositoryRoot Package repository root.
     * @param {string} [explicitTarball] Optional retained candidate to verify.
     * @returns {Promise<{ tarballPath: string, packageRoot: string, provenance: Record<string, any>, cleanup: () => Promise<void> }>} Fresh candidate.
     */
    static async create(repositoryRoot, explicitTarball = '') {
        const root = resolve(repositoryRoot)
        const temporaryRoot = await mkdtemp(
            join(tmpdir(), 'ecad-fresh-package-')
        )
        try {
            const { stdout } = await execFileAsync(
                process.env.npm_execpath || 'npm',
                ['pack', '--json', '--pack-destination', temporaryRoot],
                {
                    cwd: root,
                    env: process.env,
                    maxBuffer: 20 * 1024 * 1024
                }
            )
            const result = JSON.parse(stdout)?.[0]
            if (!result?.filename) {
                throw new Error('Fresh npm pack did not report a tarball.')
            }
            const freshTarball = join(temporaryRoot, result.filename)
            const freshDigest =
                await FreshPackageCandidate.#fileDigest(freshTarball)
            if (explicitTarball) {
                const suppliedDigest = await FreshPackageCandidate.#fileDigest(
                    resolve(explicitTarball)
                )
                if (suppliedDigest !== freshDigest) {
                    throw new Error(
                        'Explicit package candidate is stale relative to the fresh npm pack.'
                    )
                }
            }

            await execFileAsync(
                'tar',
                ['-xzf', freshTarball, '-C', temporaryRoot],
                { maxBuffer: 20 * 1024 * 1024 }
            )
            const packageRoot = join(temporaryRoot, 'package')
            const pkg = JSON.parse(
                await readFile(join(packageRoot, 'package.json'), 'utf8')
            )
            const sourceCommit = await FreshPackageCandidate.#sourceCommit(root)
            return {
                tarballPath: freshTarball,
                packageRoot,
                provenance: Object.freeze({
                    schema: 'ecad-toolkit.candidate-provenance.v1',
                    packageName: String(pkg.name || ''),
                    packageVersion: String(pkg.version || ''),
                    sourceCommit,
                    sourceDigest:
                        await FreshPackageCandidate.#treeDigest(packageRoot),
                    tarballSha256: freshDigest
                }),
                cleanup: async () =>
                    rm(temporaryRoot, { recursive: true, force: true })
            }
        } catch (error) {
            await rm(temporaryRoot, { recursive: true, force: true })
            throw error
        }
    }

    /**
     * Hashes one file.
     * @param {string} path File path.
     * @returns {Promise<string>} SHA-256 digest.
     */
    static async #fileDigest(path) {
        return createHash('sha256')
            .update(await readFile(path))
            .digest('hex')
    }

    /**
     * Hashes every packed source path and byte sequence in stable order.
     * @param {string} packageRoot Extracted package root.
     * @returns {Promise<string>} SHA-256 digest.
     */
    static async #treeDigest(packageRoot) {
        const files = await FreshPackageCandidate.#files(packageRoot)
        const hash = createHash('sha256')
        for (const path of files) {
            const packagePath = relative(packageRoot, path).replaceAll(
                '\\',
                '/'
            )
            const data = await readFile(path)
            hash.update(`${packagePath.length}:${packagePath}:${data.length}:`)
            hash.update(data)
        }
        return hash.digest('hex')
    }

    /**
     * Lists regular files recursively in stable package-relative order.
     * @param {string} directory Current directory.
     * @returns {Promise<string[]>} Sorted file paths.
     */
    static async #files(directory) {
        const files = []
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name)
            if (entry.isDirectory()) {
                files.push(...(await FreshPackageCandidate.#files(path)))
            } else if (entry.isFile()) {
                files.push(path)
            }
        }
        return files.sort((left, right) =>
            basename(left) === basename(right)
                ? left.localeCompare(right)
                : relative(directory, left).localeCompare(
                      relative(directory, right)
                  )
        )
    }

    /**
     * Reads the current Git commit when the package belongs to a worktree.
     * @param {string} repositoryRoot Repository root.
     * @returns {Promise<string | null>} Commit hash or null.
     */
    static async #sourceCommit(repositoryRoot) {
        try {
            const { stdout } = await execFileAsync(
                'git',
                ['rev-parse', 'HEAD'],
                { cwd: repositoryRoot, maxBuffer: 1024 * 1024 }
            )
            const value = stdout.trim()
            return /^[a-f0-9]{40}$/u.test(value) ? value : null
        } catch {
            return null
        }
    }
}
