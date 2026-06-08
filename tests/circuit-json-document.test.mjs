import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocument } from '../src/index.mjs'

test('CircuitJsonDocument recognizes serialized CircuitJSON element arrays', () => {
    const model = [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_1',
            center: { x: 0, y: 0 },
            width: 10,
            height: 5
        }
    ]

    assert.equal(CircuitJsonDocument.isModel(model), true)
})

test('CircuitJsonDocument rejects compatibility objects and malformed arrays', () => {
    assert.equal(
        CircuitJsonDocument.isModel({
            pcb: {
                components: []
            }
        }),
        false
    )
    assert.equal(
        CircuitJsonDocument.isModel([{ pcb_board_id: 'board_1' }]),
        false
    )
    assert.throws(
        () => CircuitJsonDocument.assertModel([{ pcb_board_id: 'board_1' }]),
        /Expected a CircuitJSON element array/
    )
})

test('CircuitJsonDocument metadata survives structured cloning', () => {
    const model = CircuitJsonDocument.attachMetadata(
        [
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                width: 10,
                height: 5
            }
        ],
        {
            fileName: 'board.json'
        }
    )
    const clonedModel = structuredClone(model)

    assert.equal(clonedModel.fileName, 'board.json')
    assert.equal(clonedModel.fileType, 'circuitjson')
    assert.equal(clonedModel.kind, 'pcb')
    assert.equal(clonedModel.sourceFormat, 'circuitjson')
})
