import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PublicContractExtractor } from '../scripts/PublicContractExtractor.mjs'

const repositoryRoot = new URL('../', import.meta.url)

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
        '.#PcbInteractionPrimitiveModel.resolveSnapPoint().result.snapped',
        '.#PcbInteractionPrimitiveModel.resolveSnapPoint().result.point',
        '.#CircuitJsonPcbDrawingStyle.fromElement().result.strokeColor',
        '.#CircuitJsonPcbDrawingStyle.fromElement().result.fillColor',
        '.#CircuitJsonPcbDrawingStyle.fromElement().result.dashArray',
        '.#CircuitJsonPcbZonePrimitiveBuilder.build().result.primitives',
        '.#CircuitJsonPcbZonePrimitiveBuilder.build().result.diagnostics'
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
})

test('immutable API baseline covers the complete live source-derived inventory', async () => {
    const baseline = JSON.parse(
        await readFile(
            new URL('spec/api-baseline-v1.0.17.json', repositoryRoot),
            'utf8'
        )
    )
    const extracted = await PublicContractExtractor.extract(repositoryRoot)
    const captured = baseline.features.filter(
        (feature) => feature.sourceContract !== undefined
    )

    assert.deepEqual(
        captured.map(contractRecord),
        extracted.map(contractRecord)
    )
})
