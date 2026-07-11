import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PcbInteractionIndex } from '../src/interaction.mjs'
import {
    PcbBoundsSelectionModel,
    PcbCandidateSelectionModel,
    PcbDiagnosticFocusModel,
    PcbInteractionPrimitiveModel
} from '../src/extensions.mjs'
import { createRichCircuitJsonDocument } from './helpers/FakePcbInteractionDocuments.mjs'

test('PcbInteractionIndex selectBounds/selectArea preserve legacy area selection', () => {
    const document = createRichCircuitJsonDocument()
    const bounds = { minX: 0.1, minY: 0.1, maxX: 1.8, maxY: 1.9 }
    const options = {
        side: 'top',
        hiddenLayers: ['bottom'],
        hiddenObjects: ['vias']
    }
    const legacy = PcbBoundsSelectionModel.resolve(document, bounds, options)
    const interaction = PcbInteractionIndex.create(document)
    const selected = interaction.selectBounds(bounds, options)

    assert.deepEqual(selected, legacy)
    assert.deepEqual(interaction.selectArea(bounds, options), legacy)
    assert.doesNotThrow(() => structuredClone(selected))
})

test('PcbInteractionIndex selectionAt and snap preserve candidate state and anchors', () => {
    const document = createRichCircuitJsonDocument()
    const point = { x: 0.6, y: 0.6 }
    const options = { tolerance: 0 }
    const legacyHits = PcbInteractionPrimitiveModel.hitTest(
        document,
        point,
        options
    )
    const legacySelected =
        PcbCandidateSelectionModel.selectedCandidate(legacyHits)
    const legacySnap = PcbInteractionPrimitiveModel.resolveSnapPoint(
        document,
        { x: 0.6, y: 0.44 },
        { tolerance: 0.05 }
    )
    const legacyDefaultSnap = PcbInteractionPrimitiveModel.resolveSnapPoint(
        document,
        { x: 0.61, y: 0.6 }
    )
    const interaction = PcbInteractionIndex.create(document)
    const state = interaction.selectionAt(point, options)

    assert.deepEqual(
        state.candidates.map((candidate) => candidate.primitiveId),
        legacyHits.map((candidate) => candidate.id)
    )
    assert.equal(state.selectedCandidate.primitiveId, String(legacySelected.id))
    assert.equal(state.componentCandidate.componentKey, 'U1')
    assert.equal(state.netCandidate.netName, 'SIG')
    assert.deepEqual(
        interaction.snap(
            { x: 0.6, y: 0.44 },
            {
                tolerance: 0.05
            }
        ),
        legacySnap
    )
    assert.deepEqual(interaction.snap({ x: 0.61, y: 0.6 }), legacyDefaultSnap)
    assert.doesNotThrow(() => structuredClone(state))
})

test('PcbInteractionIndex resolves clone-safe legacy layers and diagnostic focus lazily', () => {
    const document = createRichCircuitJsonDocument()
    const legacyLayers =
        PcbInteractionPrimitiveModel.resolveLayerGroups(document)
    const legacyFocus = PcbDiagnosticFocusModel.build(document)
    const [diagnosticId] = legacyFocus.keys()
    const interaction = PcbInteractionIndex.create(document)

    assert.equal(interaction.statistics.completePrimitiveBuilds, 0)
    assert.deepEqual(interaction.resolveLayers(), legacyLayers)
    assert.deepEqual(
        interaction.resolveDiagnosticFocus(diagnosticId),
        legacyFocus.get(diagnosticId)
    )
    assert.equal(interaction.statistics.completePrimitiveBuilds, 1)
    assert.equal(interaction.resolveDiagnosticFocus('missing'), null)
    assert.doesNotThrow(() => structuredClone(interaction.resolveLayers()))
})

test('canonical interaction preservation methods document names and parameters', async () => {
    const api = await readFile(
        new URL('../docs/api.md', import.meta.url),
        'utf8'
    )

    for (const signature of [
        'PcbInteractionIndex.create(document, options?)',
        'index.hitTest(point, options?)',
        'index.pick(point, options?)',
        'index.selectBounds(bounds, options?)',
        'index.selectArea(bounds, options?)',
        'index.selectionAt(point, options?)',
        'index.snap(point, options?)',
        'index.resolveLayers()',
        'index.resolveDiagnosticFocus(diagnosticId)'
    ]) {
        assert.match(api, new RegExp(signature.replace(/[.?()]/gu, '\\$&')))
    }
    assert.match(api, /clone-safe/u)
})
