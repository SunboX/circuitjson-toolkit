import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import * as featureChecker from '../scripts/check-feature-preservation.mjs'

const { validateFeaturePreservation } = featureChecker
const execFileAsync = promisify(execFile)

/**
 * Creates one minimal API baseline feature.
 * @param {string} feature Stable feature id.
 * @returns {Record<string, string>} Baseline feature.
 */
function baselineFeature(feature) {
    return {
        feature,
        kind: 'behavior',
        capabilityId: 'parse.document'
    }
}

/**
 * Creates one complete preservation-ledger row.
 * @param {string} feature Stable feature id.
 * @param {Record<string, any>} overrides Row overrides.
 * @returns {Record<string, any>} Ledger row.
 */
function ledgerRow(feature, overrides = {}) {
    return {
        package: 'circuitjson-toolkit@1.0.17',
        feature,
        kind: 'behavior',
        capabilityId: 'parse.document',
        disposition: 'shared',
        replacement: 'Parser.parse',
        availability: { 'circuitjson-toolkit': 'shared' },
        reason: 'Preserved.',
        tests: ['tests/api-entrypoints.test.mjs'],
        documentation: ['docs/api.md'],
        ...overrides
    }
}

/**
 * Creates an extracted-package fixture with a capability entrypoint.
 * @param {import('node:test').TestContext} context Node test context.
 * @param {Record<string, any>[]} inventory Capability inventory.
 * @returns {Promise<string>} Fixture package root.
 */
async function packedFixture(context, inventory) {
    const root = await mkdtemp(join(tmpdir(), 'circuitjson-packed-'))
    await writeFile(
        join(root, 'index.mjs'),
        `export class ToolkitCapabilities { static inventory() { return ${JSON.stringify(inventory)} } }\n`
    )
    context.after(() => rm(root, { recursive: true, force: true }))
    return root
}

test('feature checker rejects missing baseline mappings', async () => {
    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    entrypoints: [],
                    features: [baselineFeature('missing')]
                },
                ledger: []
            }),
        /Missing feature-preservation mappings: missing/
    )
})

test('feature checker rejects stale ledger mappings', async () => {
    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: { entrypoints: [], features: [] },
                ledger: [{ feature: 'stale' }]
            }),
        /Stale feature-preservation mappings: stale/
    )
})

test('feature checker requires complete preservation decisions and evidence', async () => {
    const apiBaseline = {
        entrypoints: [],
        features: [baselineFeature('mapped')]
    }
    const invalidRows = [
        ledgerRow('mapped', { disposition: 'removed' }),
        ledgerRow('mapped', { replacement: '' }),
        ledgerRow('mapped', { tests: [] }),
        ledgerRow('mapped', { documentation: [] })
    ]

    for (const row of invalidRows) {
        await assert.rejects(
            () => validateFeaturePreservation({ apiBaseline, ledger: [row] }),
            /Invalid feature-preservation row for mapped/
        )
    }
})

test('strict feature checker rejects fictitious capability mappings', async (context) => {
    const packageRoot = await packedFixture(context, [{ id: 'parse.document' }])
    const apiBaseline = {
        entrypoints: [{ entrypoint: '.', target: './index.mjs', exports: [] }],
        features: [baselineFeature('mapped')]
    }

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline,
                ledger: [
                    ledgerRow('mapped', {
                        capabilityId: 'imaginary.operation'
                    })
                ],
                strict: true,
                packageRoot
            }),
        /Fictitious capabilityId mappings: imaginary\.operation/
    )
})

test('strict feature checker rejects missing evidence paths', async (context) => {
    const packageRoot = await packedFixture(context, [{ id: 'parse.document' }])
    const apiBaseline = {
        entrypoints: [{ entrypoint: '.', target: './index.mjs', exports: [] }],
        features: [baselineFeature('mapped')]
    }

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline,
                ledger: [
                    ledgerRow('mapped', {
                        tests: ['missing.test.mjs'],
                        documentation: ['index.mjs']
                    })
                ],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Missing evidence paths: missing\.test\.mjs/
    )
})

test('strict feature checker rejects stale packed API mappings', async (context) => {
    const packageRoot = await packedFixture(context, [{ id: 'parse.document' }])
    const apiFeature = {
        feature: '.#MissingExport',
        kind: 'export',
        capabilityId: 'parse.document',
        entrypoint: '.',
        exportName: 'MissingExport'
    }
    const apiBaseline = {
        entrypoints: [{ entrypoint: '.', target: './index.mjs', exports: [] }],
        features: [apiFeature]
    }

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline,
                ledger: [
                    ledgerRow(apiFeature.feature, {
                        kind: 'export',
                        tests: ['index.mjs'],
                        documentation: ['index.mjs']
                    })
                ],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Stale packed API features: \.#MissingExport/
    )
})

test('file-backed feature checker validates the requested artifacts', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'circuitjson-ledger-'))
    const apiPath = join(root, 'api.json')
    const ledgerPath = join(root, 'ledger.json')
    await writeFile(
        apiPath,
        JSON.stringify({
            entrypoints: [],
            features: [baselineFeature('missing')]
        })
    )
    await writeFile(ledgerPath, '[]')
    context.after(() => rm(root, { recursive: true, force: true }))

    await assert.rejects(
        () =>
            featureChecker.checkFeaturePreservation({
                apiPath,
                ledgerPath,
                repositoryRoot: root
            }),
        /Missing feature-preservation mappings: missing/
    )
})

test('feature checker command reports invalid requested artifacts', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'circuitjson-ledger-cli-'))
    const apiPath = join(root, 'api.json')
    const ledgerPath = join(root, 'ledger.json')
    await writeFile(
        apiPath,
        JSON.stringify({
            entrypoints: [],
            features: [baselineFeature('missing')]
        })
    )
    await writeFile(ledgerPath, '[]')
    context.after(() => rm(root, { recursive: true, force: true }))

    await assert.rejects(
        () =>
            execFileAsync(process.execPath, [
                fileURLToPath(
                    new URL(
                        '../scripts/check-feature-preservation.mjs',
                        import.meta.url
                    )
                ),
                '--api',
                apiPath,
                '--ledger',
                ledgerPath,
                '--repository-root',
                root
            ]),
        (error) => {
            assert.match(
                String(error.stderr),
                /Missing feature-preservation mappings: missing/
            )
            return true
        }
    )
})

test('strict file-backed checker imports entrypoints from an npm pack', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'circuitjson-pack-source-'))
    const apiPath = join(root, 'api.json')
    const ledgerPath = join(root, 'ledger.json')
    await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
            name: 'circuitjson-feature-check-fixture',
            version: '1.0.0',
            type: 'module',
            exports: { '.': './index.mjs' },
            files: ['index.mjs']
        })
    )
    await writeFile(
        join(root, 'index.mjs'),
        "export class ToolkitCapabilities { static inventory() { return [{ id: 'parse.document' }] } }\n"
    )
    await writeFile(
        apiPath,
        JSON.stringify({
            entrypoints: [
                { entrypoint: '.', target: './index.mjs', exports: [] }
            ],
            features: [baselineFeature('mapped')]
        })
    )
    await writeFile(
        ledgerPath,
        JSON.stringify([
            ledgerRow('mapped', {
                tests: ['index.mjs'],
                documentation: ['index.mjs']
            })
        ])
    )
    context.after(() => rm(root, { recursive: true, force: true }))

    const result = await featureChecker.checkFeaturePreservation({
        apiPath,
        ledgerPath,
        repositoryRoot: root,
        strict: true
    })

    assert.equal(result.featureCount, 1)
})
