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
    assert.equal(Object.isFrozen(document), true)
    assert.equal(Object.isFrozen(context.source), true)
    assert.equal(Object.isFrozen(context.extensions), true)
    assert.equal(Object.isFrozen(context.assets), true)
    assert.throws(() => {
        document.model = createBoard('replacement')
    }, TypeError)
    assert.throws(() => {
        context.source.fileName = 'replacement.json'
    }, TypeError)
    assert.throws(() => {
        context.assets.push({ id: 'late-asset' })
    }, TypeError)
    assert.equal(context.model, document.model)
})

test('reflected proof data cannot authorize an invalid frozen model', () => {
    const valid = DocumentResult.createValidated({
        fileName: 'valid.json',
        model: createBoard('valid')
    })
    const [proofSymbol] = Object.getOwnPropertySymbols(valid)
    const reflectedProof = valid[proofSymbol]
    const invalidModel = Object.freeze([
        {
            type: 'pcb_board',
            pcb_board_id: 'forged',
            width: 1,
            height: 1
        }
    ])
    const forged = DocumentResult.create({
        fileName: 'forged.json',
        model: invalidModel
    })

    assert.throws(
        () => new reflectedProof.constructor(invalidModel),
        /proofs are internal/
    )
    Object.defineProperty(forged, proofSymbol, {
        value: { model: invalidModel }
    })

    assert.throws(
        () =>
            CircuitJsonDocumentContext.prepare(forged, {
                indexes: ['elements']
            }),
        /pcb_board center is required/
    )
})

test('proof-producing validation rejects custom-prototype model values', () => {
    class BoardRecord {
        constructor() {
            Object.assign(this, createBoard('custom')[0])
        }
    }

    class PointRecord {
        constructor() {
            this.x = 0
            this.y = 0
        }
    }

    assert.throws(
        () =>
            DocumentResult.createValidated({
                fileName: 'custom-element.json',
                model: [new BoardRecord()]
            }),
        /plain objects and arrays/
    )
    assert.throws(
        () =>
            DocumentResult.createValidated({
                fileName: 'custom-nested.json',
                model: [
                    {
                        ...createBoard('custom-nested')[0],
                        center: new PointRecord()
                    }
                ]
            }),
        /plain objects and arrays/
    )
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

test('derived values reject asynchronous thenables without caching them', () => {
    const context = CircuitJsonDocumentContext.prepare(createBoard('thenable'))

    assert.throws(
        () =>
            context.getOrCreateDerived('test', 'async', () =>
                Promise.resolve({ id: 'async' })
            ),
        /synchronous/
    )
    assert.deepEqual(context.statistics.derivedBuilds, {})
})

test('named context indexes build only their requested work families', () => {
    const context = CircuitJsonDocumentContext.prepare(createBoard('lazy'))
    const original = CircuitJsonIndexer.index
    const calls = []
    CircuitJsonIndexer.index = function (...args) {
        const result = original.apply(this, args)
        calls.push(Object.keys(result))
        return result
    }

    try {
        context.getIndex('elements')
        assert.equal(calls.length, 1)
        assert.equal(calls[0].includes('elementsByType'), true)
        assert.equal(calls[0].includes('relationsByField'), false)
        assert.equal(calls[0].includes('sourceTraceConnectivity'), false)
        assert.equal(calls[0].includes('diagnostics'), false)

        context.getIndex('relations')
        assert.equal(calls.length, 2)
        assert.equal(calls[1].includes('relationsByField'), true)
        assert.equal(calls[1].includes('sourceTraceConnectivity'), false)
        assert.equal(calls[1].includes('diagnostics'), false)

        context.getIndex('connectivity')
        assert.equal(calls.length, 3)
        assert.equal(calls[2].includes('sourceTraceConnectivity'), true)
        assert.equal(calls[2].includes('diagnostics'), true)
        assert.equal(calls[2].includes('groupsById'), false)

        context.getIndex('elements')
        context.getIndex('relations')
        context.getIndex('connectivity')
        assert.equal(calls.length, 3)
    } finally {
        CircuitJsonIndexer.index = original
    }
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
