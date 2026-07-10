import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import * as BaselineArtifacts from '../scripts/BaselineArtifacts.mjs'
import * as BenchmarkRunner from '../scripts/run-benchmarks.mjs'

test('baseline provenance verifies the peeled 1.0.17 commit and unchanged src tree', async () => {
    const provenance = await BaselineArtifacts.BaselineProvenance.capture()

    assert.deepEqual(provenance, {
        sourceCommit: '8c9d7deb0229d7d7d8d2f7bdcd621933e88753f9',
        sourceTree: '6740d0a6d8a1c0db3da7423c6595b8231d392f0d'
    })
})

test('immutable writer accepts identical content and rejects baseline drift', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'circuitjson-baseline-'))
    const path = join(root, 'baseline.json')
    context.after(() => rm(root, { recursive: true, force: true }))

    await BaselineArtifacts.ImmutableBaselineWriter.writeJson(path, {
        version: '1.0.17',
        value: 1
    })
    const original = await readFile(path, 'utf8')
    await BaselineArtifacts.ImmutableBaselineWriter.writeJson(path, {
        version: '1.0.17',
        value: 1
    })
    assert.equal(await readFile(path, 'utf8'), original)

    await assert.rejects(
        () =>
            BaselineArtifacts.ImmutableBaselineWriter.writeJson(path, {
                version: '1.0.17',
                value: 2
            }),
        /Refusing to overwrite immutable baseline/
    )
    assert.equal(await readFile(path, 'utf8'), original)
})

test('benchmark record paths stay repository-relative and inside the repository', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'circuitjson-record-path-'))
    context.after(() => rm(root, { recursive: true, force: true }))

    assert.equal(
        BenchmarkRunner.resolveRecordPath('benchmarks/baseline.json', root),
        join(root, 'benchmarks/baseline.json')
    )
    for (const path of ['/tmp/baseline.json', '../baseline.json']) {
        assert.throws(
            () => BenchmarkRunner.resolveRecordPath(path, root),
            /repository-relative path inside the repository/
        )
    }
})
