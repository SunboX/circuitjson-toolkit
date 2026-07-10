import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonIndexer } from '../src/core/CircuitJsonIndexer.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'

/**
 * Creates one valid nested board model for context tests.
 * @param {string} id Board id.
 * @returns {object[]} CircuitJSON model.
 */
function createBoard(id = 'board_1') {
    return [
        {
            type: 'pcb_board',
            pcb_board_id: id,
            width: 2,
            height: 1,
            center: { x: 0, y: 0 },
            outline: {
                points: [
                    { x: -1, y: -0.5 },
                    { x: 1, y: 0.5 }
                ]
            }
        }
    ]
}

test('context reuses parser proof and constructs requested indexes once', () => {
    const document = DocumentResult.createValidated({
        fileName: 'board.json',
        model: createBoard()
    })
    const context = CircuitJsonDocumentContext.prepare(document, {
        indexes: ['elements', 'connectivity']
    })
    const elements = context.getIndex('elements')
    const same = CircuitJsonDocumentContext.prepare(context, {
        indexes: ['spatial', 'elements', 'connectivity']
    })

    assert.equal(same, context)
    assert.equal(context.document, document)
    assert.equal(context.model, document.model)
    assert.equal(context.getIndex('elements'), elements)
    assert.equal(context.statistics.validationPasses, 0)
    assert.deepEqual(context.statistics.indexBuilds, {
        elements: 1,
        connectivity: 1,
        spatial: 1
    })
    assert.equal(Object.isFrozen(document.model), true)
    assert.equal(Object.isFrozen(document.model[0]), true)
    assert.equal(Object.isFrozen(document.model[0].center), true)
    assert.equal(Object.isFrozen(document.model[0].outline), true)
    assert.equal(Object.isFrozen(document.model[0].outline.points), true)
    assert.equal(Object.isFrozen(document.model[0].outline.points[0]), true)
})

test('context validates bare caller input without a process-global cache', () => {
    const model = createBoard('caller')
    const first = CircuitJsonDocumentContext.prepare(model)
    const second = CircuitJsonDocumentContext.prepare(model)

    assert.notEqual(first, second)
    assert.equal(first.model, model)
    assert.equal(second.model, model)
    assert.equal(first.statistics.validationPasses, 1)
    assert.equal(second.statistics.validationPasses, 1)
    assert.equal(Object.isFrozen(model), true)
    assert.equal(Object.isFrozen(model[0].center), true)
})

test('structured clones lose runtime proofs and validate once when prepared', () => {
    const document = DocumentResult.createValidated({
        fileName: 'worker-board.json',
        model: createBoard('worker')
    })

    assert.equal(Object.getOwnPropertySymbols(document).length, 1)
    assert.deepEqual(Object.keys(document), [
        'schema',
        'id',
        'modelSchema',
        'model',
        'source',
        'extensions',
        'assets',
        'diagnostics',
        'statistics'
    ])

    const clone = structuredClone(document)
    assert.equal(Object.getOwnPropertySymbols(clone).length, 0)
    assert.equal(Object.isFrozen(clone.model), false)

    const context = CircuitJsonDocumentContext.prepare(clone)
    assert.equal(context.statistics.validationPasses, 1)
    assert.equal(Object.isFrozen(clone.model[0].center), true)
})

test('context stays bound to the proven model for its request lifetime', () => {
    const document = DocumentResult.createValidated({
        fileName: 'stable-board.json',
        model: createBoard('stable')
    })
    const context = CircuitJsonDocumentContext.prepare(document, {
        indexes: ['elements']
    })
    const provenModel = document.model

    document.model = createBoard('replacement')

    assert.equal(context.model, provenModel)
    assert.equal(context.getIndex('elements').elements, provenModel)
})

test('derived values cache only successful factory results per namespace and key', () => {
    const context = CircuitJsonDocumentContext.prepare(createBoard('derived'))
    let attempts = 0

    assert.throws(
        () =>
            context.getOrCreateDerived('test', 'render-plan', () => {
                attempts += 1
                throw new Error('not ready')
            }),
        /not ready/
    )
    assert.deepEqual(context.statistics.derivedBuilds, {})

    const first = context.getOrCreateDerived('test', 'render-plan', () => {
        attempts += 1
        return { id: 'plan-1' }
    })
    const second = context.getOrCreateDerived('test', 'render-plan', () => ({
        id: 'plan-2'
    }))
    const other = context.getOrCreateDerived('other', 'render-plan', () => ({
        id: 'plan-3'
    }))

    assert.equal(attempts, 2)
    assert.equal(first, second)
    assert.notEqual(other, first)
    assert.deepEqual(context.statistics.derivedBuilds, {
        'test:render-plan': 1,
        'other:render-plan': 1
    })
})

test('caller data cannot claim the indexer validated shortcut', () => {
    assert.throws(
        () =>
            CircuitJsonIndexer.index(
                [
                    {
                        type: 'pcb_board',
                        pcb_board_id: 'invalid',
                        center: { x: Number.NaN, y: 0 }
                    }
                ],
                { validated: true }
            ),
        /pcb_board center is required/
    )
})
