import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonParser } from '../src/index.mjs'

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
