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
        capabilityId: 'parse.document',
        disposition: 'shared',
        replacement: 'Parser.parse()',
        availability: {
            'circuitjson-toolkit': 'shared',
            'gerber-toolkit': 'derived',
            'altium-toolkit': 'derived',
            'kicad-toolkit': 'derived'
        },
        reason: 'CircuitJSON parsing is a source-neutral shared operation.',
        tests: ['tests/api-entrypoints.test.mjs'],
        documentation: ['docs/api.md']
    }
}

/**
 * Creates one complete preservation-ledger row.
 * @param {string} feature Stable feature id.
 * @param {Record<string, any>} overrides Row overrides.
 * @returns {Record<string, any>} Ledger row.
 */
function ledgerRow(feature, overrides = {}) {
    const baseline = baselineFeature(feature)
    return {
        package: 'circuitjson-toolkit@1.0.17',
        ...baseline,
        ...overrides
    }
}

/**
 * Creates one capability inventory row.
 * @param {string} id Capability id.
 * @returns {Record<string, string>} Capability row.
 */
function capabilityRow(id) {
    const [category, operation] = id.split('.')
    return { id, category, operation }
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
    const packageRoot = await packedFixture(context, [
        capabilityRow('parse.document')
    ])
    const apiBaseline = {
        entrypoints: [{ entrypoint: '.', target: './index.mjs', exports: [] }],
        features: [
            {
                ...baselineFeature('mapped'),
                capabilityId: 'imaginary.operation'
            }
        ]
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
    const packageRoot = await packedFixture(context, [
        capabilityRow('parse.document')
    ])
    const apiBaseline = {
        entrypoints: [{ entrypoint: '.', target: './index.mjs', exports: [] }],
        features: [
            {
                ...baselineFeature('mapped'),
                tests: ['missing.test.mjs'],
                documentation: ['index.mjs']
            }
        ]
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
    const packageRoot = await packedFixture(context, [
        capabilityRow('parse.document')
    ])
    const apiFeature = {
        ...baselineFeature('.#MissingExport'),
        kind: 'export',
        entrypoint: '.',
        exportName: 'MissingExport',
        tests: ['index.mjs'],
        documentation: ['index.mjs']
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
        `export class ToolkitCapabilities { static inventory() { return ${JSON.stringify([capabilityRow('parse.document')])} } }\n`
    )
    await writeFile(
        apiPath,
        JSON.stringify({
            entrypoints: [
                { entrypoint: '.', target: './index.mjs', exports: [] }
            ],
            features: [
                {
                    ...baselineFeature('mapped'),
                    tests: ['index.mjs'],
                    documentation: ['index.mjs']
                }
            ]
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

test('feature checker rejects duplicate baseline and ledger features', async () => {
    const feature = baselineFeature('duplicate')

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    package: 'circuitjson-toolkit',
                    packageVersion: '1.0.17',
                    entrypoints: [],
                    features: [feature, feature]
                },
                ledger: [ledgerRow('duplicate')]
            }),
        /Duplicate baseline features: duplicate/
    )
    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline: {
                    package: 'circuitjson-toolkit',
                    packageVersion: '1.0.17',
                    entrypoints: [],
                    features: [feature]
                },
                ledger: [ledgerRow('duplicate'), ledgerRow('duplicate')]
            }),
        /Duplicate ledger features: duplicate/
    )
})

test('feature checker requires exact baseline and ledger mapping values', async () => {
    const apiBaseline = {
        package: 'circuitjson-toolkit',
        packageVersion: '1.0.17',
        entrypoints: [],
        features: [
            {
                ...baselineFeature('mapped'),
                tests: ['index.mjs'],
                documentation: ['index.mjs']
            }
        ]
    }
    const mismatches = [
        { kind: 'field' },
        { capabilityId: 'query.document' },
        { disposition: 'native-extension' },
        { replacement: 'Different replacement' },
        {
            availability: {
                ...baselineFeature('mapped').availability,
                'gerber-toolkit': 'unavailable'
            }
        },
        { tests: ['tests/package-layout.test.mjs'] },
        { documentation: ['docs/model-format.md'] }
    ]

    for (const mismatch of mismatches) {
        await assert.rejects(
            () =>
                validateFeaturePreservation({
                    apiBaseline,
                    ledger: [ledgerRow('mapped', mismatch)]
                }),
            /Baseline and ledger mapping differ for mapped/
        )
    }
})

test('feature checker rejects incomplete or invalid availability maps', async () => {
    const apiBaseline = {
        package: 'circuitjson-toolkit',
        packageVersion: '1.0.17',
        entrypoints: [],
        features: [baselineFeature('mapped')]
    }
    const invalidAvailability = [
        { 'circuitjson-toolkit': 'shared' },
        {
            ...baselineFeature('mapped').availability,
            'made-up-toolkit': 'shared'
        },
        {
            ...baselineFeature('mapped').availability,
            'gerber-toolkit': 'maybe'
        }
    ]

    for (const availability of invalidAvailability) {
        await assert.rejects(
            () =>
                validateFeaturePreservation({
                    apiBaseline,
                    ledger: [ledgerRow('mapped', { availability })]
                }),
            /Invalid feature-preservation row for mapped/
        )
    }
})

test('strict feature checker verifies inventory category and operation identity', async (context) => {
    const packageRoot = await packedFixture(context, [
        {
            id: 'parse.document',
            category: 'query',
            operation: 'document'
        }
    ])
    const apiBaseline = {
        package: 'circuitjson-toolkit',
        packageVersion: '1.0.17',
        entrypoints: [{ entrypoint: '.', target: './index.mjs', exports: [] }],
        features: [
            {
                ...baselineFeature('mapped'),
                tests: ['index.mjs'],
                documentation: ['index.mjs']
            }
        ]
    }

    await assert.rejects(
        () =>
            validateFeaturePreservation({
                apiBaseline,
                ledger: [
                    ledgerRow('mapped', {
                        tests: ['index.mjs'],
                        documentation: ['index.mjs']
                    })
                ],
                strict: true,
                packageRoot,
                repositoryRoot: packageRoot
            }),
        /Capability inventory identity mismatch: parse\.document/
    )
})
