import assert from 'node:assert/strict'
import test from 'node:test'

import * as rootApi from '../src/index.mjs'
import * as parserApi from '../src/parser.mjs'
import * as rendererApi from '../src/renderers.mjs'

test('root entrypoint exports CircuitJSON toolkit APIs', () => {
    assert.equal(typeof rootApi.CircuitJsonDocument, 'function')
    assert.equal(typeof rootApi.CircuitJsonIndexer, 'function')
    assert.equal(typeof rootApi.CircuitJsonParser, 'function')
    assert.equal(typeof rootApi.CircuitJsonUnits, 'function')
    assert.equal(typeof rootApi.SpiceCompatibilityPreprocessor, 'function')
    assert.equal(typeof rootApi.SpiceSimulationService, 'function')
})

test('parser entrypoint exports parser APIs', () => {
    assert.equal(typeof parserApi.CircuitJsonDocument, 'function')
    assert.equal(typeof parserApi.CircuitJsonParser, 'function')
})

test('renderer entrypoint exports CircuitJSON rendering APIs', () => {
    assert.equal(typeof rendererApi.CircuitJsonPcbSvgRenderer, 'function')
    assert.equal(typeof rendererApi.CircuitJsonSchematicSvgRenderer, 'function')
    assert.equal(typeof rendererApi.PcbInteractionPrimitiveModel, 'function')
    assert.equal(typeof rendererApi.PcbDiagnosticFocusModel, 'function')
    assert.equal(
        typeof rendererApi.CircuitJsonManufacturingDownloadBuilder,
        'function'
    )
})
