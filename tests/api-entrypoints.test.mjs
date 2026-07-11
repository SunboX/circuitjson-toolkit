import assert from 'node:assert/strict'
import test from 'node:test'

import * as rootApi from '../src/index.mjs'
import * as parserApi from '../src/parser.mjs'
import * as rendererApi from '../src/renderers.mjs'
import * as extensionsApi from '../src/extensions.mjs'

test('root entrypoint exposes canonical APIs and viewer compatibility', () => {
    assert.equal(typeof rootApi.CircuitJsonDocument, 'function')
    assert.equal(typeof rootApi.CircuitJsonIndexer, 'function')
    assert.equal(typeof rootApi.CircuitJsonUnits, 'function')
    assert.equal(typeof rootApi.Parser, 'function')
    assert.equal(typeof rootApi.ProjectLoader, 'function')
    assert.equal(typeof rootApi.CircuitJsonDocumentContext, 'function')
    assert.equal(typeof rootApi.PcbSvgRenderer, 'function')
    assert.equal(typeof rootApi.ToolkitError, 'function')
})

test('parser entrypoint exposes canonical parser contracts', () => {
    assert.equal(typeof parserApi.Parser, 'function')
    assert.equal(typeof parserApi.CircuitJsonDocumentContext, 'function')
    assert.equal(typeof parserApi.DocumentResult, 'function')
    assert.equal(typeof parserApi.ToolkitDiagnostic, 'function')
    assert.equal(typeof parserApi.ToolkitAsset, 'function')
    assert.equal(typeof parserApi.ToolkitProgress, 'function')
    assert.equal(typeof parserApi.ToolkitError, 'function')
    assert.equal(typeof parserApi.ToolkitWorkerProtocol, 'function')
    assert.equal(typeof parserApi.ParserWorkerClient, 'function')
    assert.equal(
        typeof parserApi.ParserWorkerClient.prototype.parseAttempt,
        'function'
    )
    assert.equal(
        typeof parserApi.ParserWorkerClient.prototype.loadProjectAttempt,
        'function'
    )
})

test('renderer entrypoint exposes only canonical renderers', () => {
    assert.deepEqual(Object.keys(rendererApi).sort(), [
        'BomTableRenderer',
        'PcbSvgRenderer',
        'SchematicSvgRenderer'
    ])
})

test('extensions entrypoint retains migrated CircuitJSON APIs', () => {
    assert.equal(typeof extensionsApi.CircuitJsonPcbSvgRenderer, 'function')
    assert.equal(
        typeof extensionsApi.CircuitJsonSchematicSvgRenderer,
        'function'
    )
    assert.equal(typeof extensionsApi.PcbInteractionPrimitiveModel, 'function')
    assert.equal(typeof extensionsApi.PcbDiagnosticFocusModel, 'function')
    assert.equal(
        typeof extensionsApi.CircuitJsonManufacturingDownloadBuilder,
        'function'
    )
})
