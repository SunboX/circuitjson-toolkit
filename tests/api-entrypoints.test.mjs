import assert from 'node:assert/strict'
import test from 'node:test'

import * as rootApi from '../src/index.mjs'
import * as parserApi from '../src/parser.mjs'

test('root entrypoint exports CircuitJSON toolkit APIs', () => {
    assert.equal(typeof rootApi.CircuitJsonDocument, 'function')
    assert.equal(typeof rootApi.CircuitJsonIndexer, 'function')
    assert.equal(typeof rootApi.CircuitJsonParser, 'function')
    assert.equal(typeof rootApi.CircuitJsonUnits, 'function')
})

test('parser entrypoint exports parser APIs', () => {
    assert.equal(typeof parserApi.CircuitJsonDocument, 'function')
    assert.equal(typeof parserApi.CircuitJsonParser, 'function')
})
