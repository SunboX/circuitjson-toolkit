import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('convergence baselines identify immutable source versions and primary cases', async () => {
    const source = JSON.parse(
        await readFile('spec/circuitjson-schema-source.json', 'utf8')
    )
    const api = JSON.parse(
        await readFile('spec/api-baseline-v1.0.17.json', 'utf8')
    )
    const benchmark = JSON.parse(
        await readFile('benchmarks/baseline-v1.0.17.json', 'utf8')
    )
    assert.equal(source.package, 'circuit-json')
    assert.equal(source.version, '0.0.446')
    assert.equal(api.packageVersion, '1.0.17')
    assert.equal(
        benchmark.cases.filter((entry) => entry.primary).length >= 2,
        true
    )
})
