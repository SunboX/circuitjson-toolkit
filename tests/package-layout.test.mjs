import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

/**
 * Checks whether a project-relative file exists.
 * @param {string} relativePath Project-relative file path.
 * @returns {Promise<boolean>}
 */
async function exists(relativePath) {
    try {
        await access(new URL(relativePath, root), constants.F_OK)
        return true
    } catch {
        return false
    }
}

test('required project files exist', async () => {
    const required = [
        'README.md',
        'AGENTS.md',
        'COMMERCIAL-LICENSE.md',
        'CONTRIBUTING.md',
        'package.json',
        'LICENSE',
        'LICENSES/AGPL-3.0-or-later.txt',
        'LICENSES/CC-BY-SA-4.0.txt',
        'LICENSES/LicenseRef-PolyForm-Noncommercial-1.0.0.txt',
        'REUSE.toml',
        'NOTICE.md',
        'docs/api.md',
        'docs/model-format.md',
        'docs/testing.md',
        'docs/release-notes-v1.1.1.md',
        'spec/library-scope.md',
        'src/index.mjs',
        'src/capabilities.mjs',
        'src/extensions.mjs',
        'src/interaction.mjs',
        'src/manufacturing.mjs',
        'src/parser.mjs',
        'src/project.mjs',
        'src/query.mjs',
        'src/renderers.mjs',
        'src/scene3d.mjs',
        'src/simulation.mjs',
        'src/testing.mjs',
        'src/workers/parser.worker.mjs',
        'src/styles/renderers.css'
    ]

    for (const relativePath of required) {
        assert.equal(
            await exists(relativePath),
            true,
            'Missing file: ' + relativePath
        )
    }
})

test('package exports public entrypoints', async () => {
    const raw = await readFile(new URL('package.json', root), 'utf8')
    const pkg = JSON.parse(raw)

    assert.equal(pkg.name, 'circuitjson-toolkit')
    assert.equal(pkg.type, 'module')
    assert.deepEqual(Object.keys(pkg.exports).sort(), [
        '.',
        './capabilities',
        './extensions',
        './interaction',
        './manufacturing',
        './parser',
        './project',
        './query',
        './renderers',
        './scene3d',
        './simulation',
        './styles/renderers.css',
        './testing',
        './workers/parser.worker.mjs'
    ])
    assert.equal(pkg.exports['.'], './src/index.mjs')
    assert.equal(pkg.exports['./parser'], './src/parser.mjs')
    assert.equal(pkg.exports['./project'], './src/project.mjs')
    assert.equal(pkg.exports['./renderers'], './src/renderers.mjs')
    assert.equal(pkg.exports['./interaction'], './src/interaction.mjs')
    assert.equal(pkg.exports['./query'], './src/query.mjs')
    assert.equal(pkg.exports['./manufacturing'], './src/manufacturing.mjs')
    assert.equal(pkg.exports['./simulation'], './src/simulation.mjs')
    assert.equal(pkg.exports['./scene3d'], './src/scene3d.mjs')
    assert.equal(pkg.exports['./capabilities'], './src/capabilities.mjs')
    assert.equal(pkg.exports['./extensions'], './src/extensions.mjs')
    assert.equal(pkg.exports['./testing'], './src/testing.mjs')
    assert.equal(
        pkg.exports['./workers/parser.worker.mjs'],
        './src/workers/parser.worker.mjs'
    )
    assert.equal(
        pkg.exports['./styles/renderers.css'],
        './src/styles/renderers.css'
    )
    assert.equal(
        pkg.repository.url,
        'git+https://github.com/SunboX/circuitjson-toolkit.git'
    )
    assert.equal(pkg.files.includes('docs/api.md'), true)
    assert.equal(pkg.files.includes('REUSE.toml'), true)
    assert.equal(pkg.scripts.test, 'node --test')
})
