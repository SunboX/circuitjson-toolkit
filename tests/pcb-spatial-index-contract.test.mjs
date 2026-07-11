import assert from 'node:assert/strict'
import test from 'node:test'

import { PcbSpatialIndex } from '../src/core/context/PcbSpatialIndex.mjs'

test('PcbSpatialIndex returns stable broad-phase candidates and searches', () => {
    const records = [
        { id: 'b', bounds: { minX: 5, minY: 5, maxX: 7, maxY: 7 } },
        { id: 'a', bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 } },
        { id: 'c', bounds: { minX: 1, minY: 1, maxX: 6, maxY: 6 } }
    ]
    const index = PcbSpatialIndex.create(records)

    assert.deepEqual(
        index.candidates({ x: 1.5, y: 1.5 }, 0).map((row) => row.id),
        ['a', 'c']
    )
    assert.deepEqual(
        index.candidates({ x: 3, y: 3 }, 1.1).map((row) => row.id),
        ['a', 'c']
    )
    assert.deepEqual(
        index
            .search({ minX: 5.5, minY: 5.5, maxX: 5.6, maxY: 5.6 })
            .map((row) => row.id),
        ['b', 'c']
    )
    assert.deepEqual(index.statistics, { records: 3, nodes: 1 })
})

test('PcbSpatialIndex rejects unsafe and ambiguous records without accessors', () => {
    let getterCalls = 0
    const accessor = { id: 'unsafe' }
    Object.defineProperty(accessor, 'bounds', {
        enumerable: true,
        get() {
            getterCalls += 1
            return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
        }
    })

    assert.throws(() => PcbSpatialIndex.create([accessor]), {
        code: 'ERR_SPATIAL_INDEX_RECORD'
    })
    assert.equal(getterCalls, 0)
    assert.throws(
        () =>
            PcbSpatialIndex.create([
                {
                    id: 'same',
                    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }
                },
                {
                    id: 'same',
                    bounds: { minX: 2, minY: 2, maxX: 3, maxY: 3 }
                }
            ]),
        { code: 'ERR_SPATIAL_INDEX_RECORD' }
    )
    assert.throws(
        () =>
            PcbSpatialIndex.create([
                {
                    id: 'reversed',
                    bounds: { minX: 2, minY: 0, maxX: 1, maxY: 1 }
                }
            ]),
        { code: 'ERR_SPATIAL_INDEX_RECORD' }
    )
    assert.throws(() => PcbSpatialIndex.create({}), TypeError)
})

test('PcbSpatialIndex validates and indexes one immutable hostile-record snapshot', () => {
    let inspections = 0
    const indexedBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const changedBounds = { minX: 100, minY: 100, maxX: 101, maxY: 101 }
    const source = new Proxy(
        { id: 'indexed', bounds: indexedBounds },
        {
            ownKeys(target) {
                inspections += 1
                return Reflect.ownKeys(target)
            },
            getOwnPropertyDescriptor(target, key) {
                const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
                if (key === 'id') {
                    return {
                        ...descriptor,
                        value: inspections === 1 ? 'indexed' : 'returned'
                    }
                }
                if (key === 'bounds') {
                    return {
                        ...descriptor,
                        value: inspections === 1 ? indexedBounds : changedBounds
                    }
                }
                return descriptor
            }
        }
    )

    const index = PcbSpatialIndex.create([source])

    assert.equal(inspections, 1)
    assert.deepEqual(index.search(indexedBounds), [
        { id: 'indexed', bounds: indexedBounds }
    ])
    assert.deepEqual(index.search(changedBounds), [])
})

test('PcbSpatialIndex validates point, tolerance, and search bounds', () => {
    const index = PcbSpatialIndex.create([])

    assert.deepEqual(index.candidates({ x: 0, y: 0 }), [])
    assert.deepEqual(index.search({ minX: 0, minY: 0, maxX: 1, maxY: 1 }), [])
    for (const operation of [
        () => index.candidates({ x: NaN, y: 0 }),
        () => index.candidates({ x: 0, y: 0 }, -1),
        () => index.search({ minX: 2, minY: 0, maxX: 1, maxY: 1 })
    ]) {
        assert.throws(operation, { code: 'ERR_SPATIAL_INDEX_QUERY' })
    }
})

test('PcbSpatialIndex rejects hostile record lists without executing accessors', () => {
    let getterCalls = 0
    const accessorList = []
    Object.defineProperty(accessorList, '0', {
        enumerable: true,
        get() {
            getterCalls += 1
            return {
                id: 'unsafe',
                bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }
            }
        }
    })
    const customPrototypeList = []
    Object.setPrototypeOf(customPrototypeList, Object.create(Array.prototype))

    for (const records of [
        new Array(1),
        accessorList,
        customPrototypeList,
        { length: 0 }
    ]) {
        assert.throws(() => PcbSpatialIndex.create(records), TypeError)
    }
    assert.equal(getterCalls, 0)
})

test('PcbSpatialIndex bounds record count, ids, and query tolerance', () => {
    const excessive = []
    excessive.length = 100_001

    assert.throws(() => PcbSpatialIndex.create(excessive), {
        code: 'ERR_SPATIAL_INDEX_RECORD'
    })
    assert.throws(
        () =>
            PcbSpatialIndex.create([
                {
                    id: 'x'.repeat(1025),
                    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }
                }
            ]),
        { code: 'ERR_SPATIAL_INDEX_RECORD' }
    )
    const index = PcbSpatialIndex.create([])
    assert.throws(() => index.candidates({ x: 0, y: 0 }, 1_000_001), {
        code: 'ERR_SPATIAL_INDEX_QUERY'
    })
})

test('PcbSpatialIndex snapshots and freezes records and returned data', () => {
    const source = {
        id: 'snapshot',
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        metadata: { layers: ['top'] }
    }
    const index = PcbSpatialIndex.create([source])
    source.id = 'mutated'
    source.bounds.maxX = 100
    source.metadata.layers.push('bottom')

    const [record] = index.search({ minX: 0, minY: 0, maxX: 1, maxY: 1 })
    assert.notEqual(record, source)
    assert.deepEqual(record, {
        id: 'snapshot',
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        metadata: { layers: ['top'] }
    })
    assert.equal(Object.isFrozen(record), true)
    assert.equal(Object.isFrozen(record.bounds), true)
    assert.equal(Object.isFrozen(record.metadata.layers), true)
    assert.throws(() => {
        record.metadata.layers.push('unsafe')
    }, TypeError)
    assert.doesNotThrow(() => structuredClone(record))
})

test('PcbSpatialIndex snapshots nested arrays without ordinary property reads', () => {
    let propertyReads = 0
    const metadata = new Proxy([], {
        get(target, property, receiver) {
            propertyReads += 1
            return Reflect.get(target, property, receiver)
        }
    })

    const index = PcbSpatialIndex.create([
        {
            id: 'descriptor-only',
            bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
            metadata
        }
    ])

    assert.equal(propertyReads, 0)
    assert.deepEqual(
        index.search({ minX: 0, minY: 0, maxX: 1, maxY: 1 })[0].metadata,
        []
    )
})

test('PcbSpatialIndex rejects sparse and oversized nested arrays before declared-length allocation', () => {
    const originalArrayFrom = Array.from
    const declaredLengthAllocations = []
    Array.from = function (value, ...args) {
        const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
        if (Number.isSafeInteger(length) && length >= 100_000) {
            declaredLengthAllocations.push(length)
        }
        return Reflect.apply(originalArrayFrom, this, [value, ...args])
    }

    try {
        for (const length of [100_000, 250_000, 500_000]) {
            const metadata = []
            metadata.length = length
            assert.throws(
                () =>
                    PcbSpatialIndex.create([
                        {
                            id: `sparse-${length}`,
                            bounds: {
                                minX: 0,
                                minY: 0,
                                maxX: 1,
                                maxY: 1
                            },
                            metadata
                        }
                    ]),
                { code: 'ERR_SPATIAL_INDEX_RECORD' }
            )
        }
    } finally {
        Array.from = originalArrayFrom
    }

    assert.deepEqual(declaredLengthAllocations, [])
    assert.throws(
        () =>
            PcbSpatialIndex.create([
                {
                    id: 'oversized-nested-array',
                    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
                    metadata: new Array(100_001).fill(0)
                }
            ]),
        { code: 'ERR_SPATIAL_INDEX_RECORD' }
    )
})

test('PcbSpatialIndex bounds aggregate primitive and object snapshot slots', () => {
    const records = Array.from({ length: 10 }, (_entry, index) => ({
        id: `aggregate-${index}`,
        bounds: {
            minX: index,
            minY: 0,
            maxX: index + 0.5,
            maxY: 0.5
        },
        metadata: new Array(100_000).fill(0)
    }))

    assert.throws(() => PcbSpatialIndex.create(records), {
        code: 'ERR_SPATIAL_INDEX_RECORD',
        message: /at most 1000000 aggregate slots/u
    })
})

test('PcbSpatialIndex snapshots shared metadata once across scaling populations', () => {
    const inspectionCounts = []

    for (const count of [250, 500, 1000]) {
        let inspections = 0
        const sharedMetadata = new Proxy(
            { values: new Array(count).fill(0) },
            {
                ownKeys(target) {
                    inspections += 1
                    return Reflect.ownKeys(target)
                }
            }
        )
        const records = Array.from({ length: count }, (_entry, index) => ({
            id: `shared-${count}-${index}`,
            bounds: {
                minX: index,
                minY: 0,
                maxX: index + 0.5,
                maxY: 0.5
            },
            metadata: sharedMetadata
        }))
        const index = PcbSpatialIndex.create(records)
        const returned = index.search({
            minX: 0,
            minY: 0,
            maxX: count,
            maxY: 1
        })

        inspectionCounts.push(inspections)
        assert.equal(returned.length, count)
        assert.notEqual(returned[0], returned.at(-1))
        assert.equal(returned[0].metadata, returned.at(-1).metadata)
        assert.equal(Object.isFrozen(returned[0]), true)
        assert.equal(Object.isFrozen(returned[0].metadata), true)
        assert.throws(() => returned[0].metadata.values.push(1), TypeError)
    }

    assert.deepEqual(inspectionCounts, [1, 1, 1])
})

test('PcbSpatialIndex separates structural TypeErrors from semantic ToolkitErrors', () => {
    const index = PcbSpatialIndex.create([])

    assert.throws(() => PcbSpatialIndex.create(null), TypeError)
    assert.throws(() => index.candidates([], 0), TypeError)
    assert.throws(() => index.search([]), TypeError)
    assert.throws(() => index.candidates({ x: Infinity, y: 0 }, 0), {
        code: 'ERR_SPATIAL_INDEX_QUERY'
    })
})
