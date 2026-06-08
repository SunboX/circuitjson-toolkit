import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonIndexer } from '../src/index.mjs'

test('CircuitJsonIndexer groups PCB elements by type and id', () => {
    const board = {
        type: 'pcb_board',
        pcb_board_id: 'board_1',
        center: { x: 0, y: 0 },
        width: 10,
        height: 5
    }
    const sourceComponent = {
        type: 'source_component',
        source_component_id: 'source_r1',
        name: 'R1'
    }
    const pcbComponent = {
        type: 'pcb_component',
        pcb_component_id: 'pcb_r1',
        source_component_id: 'source_r1',
        center: { x: 1, y: 2 },
        layer: 'top'
    }

    const index = CircuitJsonIndexer.index([
        board,
        sourceComponent,
        pcbComponent
    ])

    assert.deepEqual(index.elementsByType.get('pcb_board'), [board])
    assert.equal(index.elementsById.get('pcb_board:board_1'), board)
    assert.equal(
        index.elementsById.get('source_component:source_r1'),
        sourceComponent
    )
    assert.equal(index.sourceComponentById.get('source_r1'), sourceComponent)
    assert.equal(index.pcbComponentById.get('pcb_r1'), pcbComponent)
})
