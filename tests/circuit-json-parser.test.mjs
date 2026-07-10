import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonParser } from '../src/parser.mjs'

test('CircuitJsonParser parses standalone CircuitJSON text', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                center: { x: 1, y: 2 },
                width: 10,
                height: 6
            }
        ])
    )

    assert.equal(model[0].type, 'pcb_board')
    assert.equal(model.fileType, 'circuitjson')
    assert.equal(model.kind, 'pcb')
    assert.equal(Object.isFrozen(model), false)
    assert.equal(Array.isArray(model.bom), true)
    assert.equal(typeof model.manufacturing, 'object')
})

test('CircuitJsonParser keeps its legacy byte-array migration contract', () => {
    const model = CircuitJsonParser.parseBytes(new TextEncoder().encode('[]'), {
        fileName: 'legacy.json'
    })

    assert.equal(Array.isArray(model), true)
    assert.equal(model.fileName, 'legacy.json')
    assert.equal(model.sourceFormat, 'circuitjson')
})

test('CircuitJsonParser reports invalid standalone JSON clearly', () => {
    assert.throws(
        () => CircuitJsonParser.parseText('{not json'),
        /CircuitJSON file is not valid JSON/
    )
    assert.throws(
        () => CircuitJsonParser.parseText('{"pcb":{"components":[]}}'),
        /Expected a CircuitJSON element array/
    )
})
