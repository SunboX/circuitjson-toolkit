import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('query provenance records every independently implemented module and consulted source', async () => {
    const provenance = await readFile(
        new URL('docs/provenance.md', root),
        'utf8'
    )
    const notice = await readFile(new URL('NOTICE.md', root), 'utf8')

    for (const moduleName of [
        'RegexPattern.mjs',
        'ComponentGrouping.mjs',
        'CircuitTraversal.mjs',
        'QueryNetlistBuilder.mjs',
        'QueryService.mjs'
    ]) {
        assert.equal(provenance.includes(moduleName), true, moduleName)
    }
    for (const evidence of [
        '9fa22e1028d96e583275093279bf6e03e8619588',
        'c71c88d69d236accce123656dfa66914c0d5489c',
        'GPL-3.0-or-later',
        'behavior',
        'independent'
    ]) {
        assert.equal(provenance.includes(evidence), true, evidence)
    }
    assert.equal(notice.includes('Query behavior references'), true)
    assert.equal(notice.includes('GPL-3.0-or-later'), true)
})
