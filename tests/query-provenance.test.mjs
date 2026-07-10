import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

/**
 * Extracts one Markdown heading section up to the next equal-level heading.
 * @param {string} markdown Markdown source.
 * @param {string} heading Heading text without markers.
 * @param {number} level Heading level.
 * @returns {string} Section source.
 */
function section(markdown, heading, level) {
    const marker = `${'#'.repeat(level)} ${heading}`
    const start = markdown.indexOf(marker)
    assert.notEqual(start, -1, marker)
    const bodyStart = start + marker.length
    const next = markdown.indexOf(`\n${'#'.repeat(level)} `, bodyStart)
    return markdown.slice(start, next === -1 ? markdown.length : next)
}

test('query provenance records every independently implemented module and consulted source', async () => {
    const provenance = await readFile(
        new URL('docs/provenance.md', root),
        'utf8'
    )
    const notice = await readFile(new URL('NOTICE.md', root), 'utf8')

    const modules = new Map([
        ['RegexPattern.mjs', 'RegexPattern.mjs'],
        ['ComponentGrouping.mjs', 'ComponentGrouping.mjs'],
        ['CircuitTraversal.mjs', 'CircuitTraversal.mjs'],
        ['QueryNetlistBuilder.mjs', 'QueryNetlistBuilder.mjs'],
        ['QueryService.mjs', 'LoadedDesignNetlistService.mjs']
    ])
    const sources = [
        {
            heading: 'Altium Toolkit source',
            repository: 'https://github.com/SunboX/altium-toolkit',
            worktreeCommit: '9fa22e1028d96e583275093279bf6e03e8619588',
            sourceCommit: 'e8a8cd551ad103cd0cf96bb5b5f5b816874ed72b'
        },
        {
            heading: 'KiCad Toolkit source',
            repository: 'https://github.com/SunboX/kicad-toolkit',
            worktreeCommit: 'c71c88d69d236accce123656dfa66914c0d5489c',
            sourceCommit: '02e38fe0b961a09d2ff25462b9b00207326743d2'
        }
    ]

    for (const [moduleName, sourceModuleName] of modules) {
        const moduleSection = section(provenance, moduleName, 3)
        assert.match(moduleSection, new RegExp(`src/core/query/${moduleName}`))
        for (const source of sources) {
            const sourceSection = section(moduleSection, source.heading, 4)
            for (const evidence of [
                source.repository,
                `src/core/netlist-query/${sourceModuleName}`,
                source.worktreeCommit,
                source.sourceCommit,
                '2026 André Fiedler',
                'GPL-3.0-or-later'
            ]) {
                assert.equal(sourceSection.includes(evidence), true, evidence)
            }
        }
        const decision = section(moduleSection, 'Decision', 4)
        const normalizedDecision = decision.replace(/\s+/g, ' ')
        assert.match(normalizedDecision, /behavior-only/i)
        assert.match(normalizedDecision, /independent/i)
        assert.match(normalizedDecision, /no source text or algorithm/i)
    }
    assert.equal(notice.includes('Query behavior references'), true)
    assert.equal(notice.includes('GPL-3.0-or-later'), true)
})
