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
    assert.throws(() => PcbSpatialIndex.create({}), {
        code: 'ERR_SPATIAL_INDEX_RECORD'
    })
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
