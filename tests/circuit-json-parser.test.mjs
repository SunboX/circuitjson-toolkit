import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonIndexer } from '../src/index.mjs'
import { CircuitJsonParser } from '../src/extensions.mjs'

/**
 * Creates one parsed legacy view and consumes its one-shot prepared index.
 * @returns {object[]} Mutable legacy array over immutable element records.
 */
function parsedLegacyView() {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'source_net',
                source_net_id: 'legacy-net',
                name: 'LEGACY'
            }
        ])
    )
    CircuitJsonIndexer.index(model)
    return model
}

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

test('legacy indexing ignores shadowed array iteration methods after cache reuse', () => {
    const model = parsedLegacyView()
    Object.defineProperties(model, {
        forEach: {
            configurable: true,
            value() {},
            writable: true
        },
        map: {
            configurable: true,
            value() {
                return []
            },
            writable: true
        },
        [Symbol.iterator]: {
            configurable: true,
            value() {
                return [][Symbol.iterator]()
            },
            writable: true
        }
    })

    const index = CircuitJsonIndexer.index(model)

    assert.equal(index.elementsById.get('source_net:legacy-net'), model[0])
    assert.deepEqual(index.elementsByType.get('source_net'), [model[0]])
})

test('legacy indexing never reads hostile array-method or iterator getters', () => {
    const model = parsedLegacyView()
    let reads = 0
    for (const key of ['forEach', 'map', Symbol.iterator]) {
        Object.defineProperty(model, key, {
            configurable: true,
            get() {
                reads += 1
                throw new Error('shadow getter executed')
            }
        })
    }

    const index = CircuitJsonIndexer.index(model)

    assert.equal(index.elementsById.has('source_net:legacy-net'), true)
    assert.equal(reads, 0)
})

test('changed legacy slots fall back to validation before indexing', () => {
    const model = parsedLegacyView()
    const replacement = Object.freeze({
        type: 'source_net',
        source_net_id: 'replacement-net',
        name: 'REPLACEMENT',
        member_source_group_ids: []
    })
    model[0] = replacement
    Object.defineProperties(model, {
        forEach: { configurable: true, value() {} },
        map: { configurable: true, value: () => [] },
        [Symbol.iterator]: {
            configurable: true,
            value: () => [][Symbol.iterator]()
        }
    })

    const index = CircuitJsonIndexer.index(model)
    assert.equal(
        index.elementsById.get('source_net:replacement-net'),
        replacement
    )

    let reads = 0
    Object.defineProperty(model, '0', {
        configurable: true,
        enumerable: true,
        get() {
            reads += 1
            return replacement
        }
    })
    assert.throws(() => CircuitJsonIndexer.index(model), /own data properties/u)
    assert.equal(reads, 0)
})
