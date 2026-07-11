import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { PublicContractExtractor } from '../scripts/PublicContractExtractor.mjs'
import {
    CircuitJsonPcbDrawingStyle,
    CircuitJsonPcbZonePrimitiveBuilder
} from '../src/extensions.mjs'

const repositoryRoot = new URL('../', import.meta.url)
const execFileAsync = promisify(execFile)
const baselineCommit = '8c9d7deb0229d7d7d8d2f7bdcd621933e88753f9'

/**
 * Extracts public contracts from the immutable baseline Git tree.
 * @param {import('node:test').TestContext} context Test context.
 * @returns {Promise<Record<string, any>[]>} Baseline source contracts.
 */
async function extractBaselineContracts(context) {
    const root = await mkdtemp(join(tmpdir(), 'circuitjson-contract-tree-'))
    const archive = join(root, 'source.tar')
    context.after(() => rm(root, { recursive: true, force: true }))
    await execFileAsync(
        'git',
        [
            'archive',
            '--format=tar',
            `--output=${archive}`,
            baselineCommit,
            'package.json',
            'src'
        ],
        { cwd: fileURLToPath(repositoryRoot) }
    )
    await execFileAsync('tar', ['-xf', archive, '-C', root])
    return PublicContractExtractor.extract(pathToFileURL(`${root}/`))
}

/**
 * Selects the stable source-derived contract representation.
 * @param {Record<string, any>} feature Baseline or extracted feature.
 * @returns {Record<string, any>} Comparable contract record.
 */
function contractRecord(feature) {
    return {
        feature: feature.feature,
        kind: feature.kind,
        entrypoint: feature.entrypoint,
        exportName: feature.exportName,
        methodName: feature.methodName,
        methodType: feature.methodType,
        sourceContract: feature.sourceContract
    }
}

test('source extractor derives public signatures, arguments, property reads, and result fields', async () => {
    const contracts = await PublicContractExtractor.extract(repositoryRoot)
    const byFeature = new Map(
        contracts.map((contract) => [contract.feature, contract])
    )

    for (const feature of [
        './extensions#PcbInteractionPrimitiveModel.resolveSnapPoint().result.snapped',
        './extensions#PcbInteractionPrimitiveModel.resolveSnapPoint().result.point',
        './extensions#CircuitJsonPcbDrawingStyle.fromElement().result.strokeColor',
        './extensions#CircuitJsonPcbDrawingStyle.fromElement().result.fillColor',
        './extensions#CircuitJsonPcbDrawingStyle.fromElement().result.dashArray',
        './extensions#CircuitJsonPcbZonePrimitiveBuilder.build().result.primitives',
        './extensions#CircuitJsonPcbZonePrimitiveBuilder.build().result.diagnostics'
    ]) {
        assert.ok(byFeature.has(feature), `missing ${feature}`)
    }

    const unitFallbacks = contracts.filter(
        (contract) =>
            contract.exportName === 'CircuitJsonUnits' &&
            contract.sourceContract?.type === 'argument' &&
            contract.sourceContract.name === 'fallback'
    )
    assert.equal(unitFallbacks.length, 3)
    assert.ok(
        unitFallbacks.every(
            (contract) => contract.sourceContract.defaultSource === '0'
        )
    )
    assert.equal(typeof CircuitJsonPcbDrawingStyle.fromElement, 'function')
    assert.equal(typeof CircuitJsonPcbZonePrimitiveBuilder.build, 'function')
})

test('immutable API baseline covers the approved source-derived inventory', async (context) => {
    const baseline = JSON.parse(
        await readFile(
            new URL('spec/api-baseline-v1.0.17.json', repositoryRoot),
            'utf8'
        )
    )
    const extracted = await extractBaselineContracts(context)
    const captured = baseline.features.filter(
        (feature) => feature.sourceContract !== undefined
    )

    assert.deepEqual(
        captured.map(contractRecord),
        extracted.map(contractRecord)
    )
})
