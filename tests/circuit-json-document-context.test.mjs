import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { CircuitJsonDocument } from '../src/core/CircuitJsonDocument.mjs'
import { CircuitJsonIndexer } from '../src/core/CircuitJsonIndexer.mjs'
import { CircuitJsonUnits } from '../src/core/CircuitJsonUnits.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { CircuitJsonValidationProof } from '../src/core/context/CircuitJsonValidationProof.mjs'
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
        model: createBoard('stable'),
        assets: [
            {
                id: 'asset-1',
                kind: 'binary',
                data: new Uint8Array([1, 2])
            }
        ]
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
    const exposedBytes = context.assets[0].data
    exposedBytes[0] = 9
    assert.deepEqual([...context.assets[0].data], [1, 2])
    assert.deepEqual([...structuredClone(document).assets[0].data], [1, 2])
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

test('reflected proof authorization cannot be monkey-patched', () => {
    const document = DocumentResult.createValidated({
        fileName: 'proof.json',
        model: createBoard('proof')
    })
    const [proofSymbol] = Object.getOwnPropertySymbols(document)
    const proof = document[proofSymbol]
    const tokenClass = proof.constructor
    const originalMatches = tokenClass.matches
    let mutationError = null

    try {
        tokenClass.matches = () => true
    } catch (error) {
        mutationError = error
    } finally {
        if (tokenClass.matches !== originalMatches) {
            Object.defineProperty(tokenClass, 'matches', {
                configurable: true,
                value: originalMatches,
                writable: true
            })
        }
    }

    assert.equal(mutationError instanceof TypeError, true)
    assert.equal(Object.isFrozen(tokenClass), true)
    assert.equal(Object.isFrozen(Object.getPrototypeOf(proof)), true)
})

test('public validator monkey-patching cannot mint validation proofs', () => {
    const document = DocumentResult.create({
        fileName: 'invalid-proof.json',
        model: [
            {
                type: 'pcb_board',
                pcb_board_id: 'invalid-proof',
                width: 1,
                height: 1
            }
        ]
    })
    const originalAssertModel = CircuitJsonDocument.assertModel

    try {
        CircuitJsonDocument.assertModel = () => {}
        assert.throws(
            () => CircuitJsonValidationProof.validateAndAttach(document),
            /pcb_board center is required/
        )
    } finally {
        CircuitJsonDocument.assertModel = originalAssertModel
    }
})

test('public unit-parser monkey-patching cannot mint validation proofs', () => {
    const originalOptionalPoint = CircuitJsonUnits.optionalPoint
    const originalOptionalLength = CircuitJsonUnits.optionalLength
    const document = DocumentResult.create({
        fileName: 'invalid-units-proof.json',
        model: [
            {
                type: 'pcb_board',
                pcb_board_id: 'invalid-units-proof',
                center: {},
                width: 1,
                height: 1
            }
        ]
    })

    try {
        CircuitJsonUnits.optionalPoint = () => ({ x: 0, y: 0 })
        CircuitJsonUnits.optionalLength = () => 0
        assert.throws(
            () => CircuitJsonValidationProof.validateAndAttach(document),
            /pcb_board center is required/
        )
    } finally {
        CircuitJsonUnits.optionalPoint = originalOptionalPoint
        CircuitJsonUnits.optionalLength = originalOptionalLength
    }
})

test('unit-parser import order cannot poison proof validation', () => {
    const unitsUrl = new URL(
        '../src/core/CircuitJsonUnits.mjs',
        import.meta.url
    ).href
    const documentResultUrl = new URL(
        '../src/core/contracts/DocumentResult.mjs',
        import.meta.url
    ).href
    const script = `
        const { CircuitJsonUnits } = await import(${JSON.stringify(unitsUrl)})
        CircuitJsonUnits.optionalLength = () => 0
        CircuitJsonUnits.optionalPoint = () => ({ x: 0, y: 0 })
        CircuitJsonUnits.optionalSize = () => ({ width: 1, height: 1 })
        const { DocumentResult } = await import(${JSON.stringify(documentResultUrl)})
        try {
            DocumentResult.createValidated({
                fileName: 'load-order.json',
                model: [{
                    type: 'pcb_board',
                    pcb_board_id: 'load-order',
                    center: {},
                    width: {},
                    height: {}
                }]
            })
            process.exit(1)
        } catch (error) {
            if (!/pcb_board center is required/.test(String(error?.message))) {
                console.error(error)
                process.exit(2)
            }
        }
    `
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', script],
        { encoding: 'utf8' }
    )

    assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('element-validator import order cannot poison proof validation', () => {
    const validatorUrl = new URL(
        '../src/core/CircuitJsonElementValidator.mjs',
        import.meta.url
    ).href
    const documentResultUrl = new URL(
        '../src/core/contracts/DocumentResult.mjs',
        import.meta.url
    ).href
    const script = `
        const { CircuitJsonElementValidator } = await import(${JSON.stringify(validatorUrl)})
        try {
            CircuitJsonElementValidator.validateElement = () => []
        } catch {}
        const { DocumentResult } = await import(${JSON.stringify(documentResultUrl)})
        try {
            DocumentResult.createValidated({
                fileName: 'validator-load-order.json',
                model: [{ type: 'not_a_circuitjson_element' }]
            })
            process.exit(1)
        } catch (error) {
            if (!/Unsupported CircuitJSON element type/.test(String(error?.message))) {
                console.error(error)
                process.exit(2)
            }
        }
    `
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', script],
        { encoding: 'utf8' }
    )

    assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('proof attachment rejects accessor-backed envelope models', () => {
    const original = createBoard('captured')
    const replacement = Object.freeze([
        {
            type: 'pcb_board',
            pcb_board_id: 'replacement',
            width: 1,
            height: 1
        }
    ])
    const document = DocumentResult.create({
        fileName: 'captured.json',
        model: original
    })
    let reads = 0
    Object.defineProperty(document, 'model', {
        configurable: true,
        enumerable: true,
        get() {
            reads += 1
            return reads === 1 ? original : replacement
        }
    })

    assert.throws(
        () => CircuitJsonValidationProof.validateAndAttach(document),
        /own data property/
    )
})

test('proof-producing validation rejects accessor-backed records', () => {
    const model = createBoard('accessor')
    let type = 'pcb_board'
    Object.defineProperty(model[0], 'type', {
        configurable: true,
        enumerable: true,
        get() {
            return type
        }
    })

    assert.throws(
        () =>
            DocumentResult.createValidated({
                fileName: 'accessor.json',
                model
            }),
        /data properties/
    )
    type = 'invalid_after_validation'
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

test('proof-producing validation rejects mutable function values', () => {
    const model = createBoard('function-value')
    model[0].runtimeHook = () => 'mutable'

    assert.throws(
        () =>
            DocumentResult.createValidated({
                fileName: 'function-value.json',
                model
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
