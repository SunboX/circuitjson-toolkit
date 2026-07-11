import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FreshPackageCandidate } from '../scripts/FreshPackageCandidate.mjs'

/**
 * Creates one minimal npm package fixture.
 * @param {import('node:test').TestContext} context Test context.
 * @returns {Promise<string>} Fixture root.
 */
async function packageFixture(context) {
    const root = await mkdtemp(join(tmpdir(), 'fresh-package-fixture-'))
    await Promise.all([
        writeFile(
            join(root, 'package.json'),
            JSON.stringify({
                name: 'fresh-candidate-fixture',
                version: '1.0.0',
                type: 'module',
                files: ['index.mjs']
            })
        ),
        writeFile(join(root, 'index.mjs'), 'export const value = 1\n')
    ])
    context.after(() => rm(root, { recursive: true, force: true }))
    return root
}

test('fresh candidate packs without a retained tarball and reports two live digests', async (context) => {
    const root = await packageFixture(context)
    const candidate = await FreshPackageCandidate.create(root)
    context.after(candidate.cleanup)

    assert.match(candidate.provenance.sourceDigest, /^[a-f0-9]{64}$/u)
    assert.match(candidate.provenance.tarballSha256, /^[a-f0-9]{64}$/u)
    assert.equal(candidate.provenance.packageName, 'fresh-candidate-fixture')
    assert.equal(candidate.provenance.packageVersion, '1.0.0')
})

test('explicit stale candidates are rejected against a fresh pack', async (context) => {
    const root = await packageFixture(context)
    const first = await FreshPackageCandidate.create(root)
    context.after(first.cleanup)
    await writeFile(join(root, 'index.mjs'), 'export const value = 2\n')

    await assert.rejects(
        () => FreshPackageCandidate.create(root, first.tarballPath),
        /stale.*fresh npm pack/iu
    )
})
