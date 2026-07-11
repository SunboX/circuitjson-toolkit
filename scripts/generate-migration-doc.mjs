import { mkdir, writeFile } from 'node:fs/promises'

import { format } from 'prettier'

import { synchronizeFeaturePreservation } from './capture-api-baseline.mjs'

const OUTPUT_URL = new URL('../docs/migration.md', import.meta.url)
const APPENDIX_DIRECTORY_URL = new URL('../docs/migration/', import.meta.url)
const APPENDIX_PAGES = Object.freeze([
    Object.freeze({
        id: 'root',
        title: 'Root entrypoint',
        matches: (feature) => feature.startsWith('.#')
    }),
    Object.freeze({
        id: 'parser',
        title: 'Parser entrypoint',
        matches: (feature) => feature.startsWith('./parser#')
    }),
    Object.freeze({
        id: 'renderers',
        title: 'Legacy renderer entrypoint',
        matches: (feature) => feature.startsWith('./renderers#')
    }),
    Object.freeze({
        id: 'behaviors',
        title: 'Observable behaviors',
        matches: (feature) => !feature.includes('#')
    })
])

/**
 * Escapes one value for a Markdown table without changing searchable text.
 * @param {unknown} value Cell value.
 * @returns {string} Markdown-safe cell.
 */
function cell(value) {
    return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

/**
 * Formats the four-toolkit availability map in stable package order.
 * @param {Record<string, string>} availability Availability map.
 * @returns {string} Compact availability text.
 */
function availabilityText(availability) {
    return [
        ['CircuitJSON', 'circuitjson-toolkit'],
        ['Gerber', 'gerber-toolkit'],
        ['Altium', 'altium-toolkit'],
        ['KiCad', 'kicad-toolkit']
    ]
        .map(([label, key]) => `${label}: ${availability[key]}`)
        .join('; ')
}

/**
 * Builds one generated exhaustive ledger table grouped by capability.
 * @param {Record<string, any>[]} rows Feature rows.
 * @returns {string} Markdown ledger table sections.
 */
function ledgerTables(rows) {
    const grouped = new Map()
    for (const row of rows) {
        if (!grouped.has(row.capabilityId)) grouped.set(row.capabilityId, [])
        grouped.get(row.capabilityId).push(row)
    }
    const sections = []
    for (const capabilityId of [...grouped.keys()].sort()) {
        const entries = grouped
            .get(capabilityId)
            .toSorted((left, right) =>
                left.feature.localeCompare(right.feature)
            )
        const lines = [
            `## ${capabilityId}`,
            '',
            '| 1.0.17 feature | Kind | Disposition | 1.1.0 replacement | Availability |',
            '| --- | --- | --- | --- | --- |'
        ]
        for (const row of entries) {
            lines.push(
                `| ${cell(row.feature)} | ${cell(row.kind)} | ${cell(row.disposition)} | ${cell(row.replacement)} | ${cell(availabilityText(row.availability))} |`
            )
        }
        sections.push(lines.join('\n'))
    }
    return sections.join('\n\n')
}

/**
 * Selects and verifies the deterministic appendix page for every row.
 * @param {Record<string, any>[]} rows Feature rows.
 * @returns {{ id: string, title: string, rows: Record<string, any>[] }[]} Populated pages.
 */
function appendixPages(rows) {
    const pages = APPENDIX_PAGES.map((page) => ({
        id: page.id,
        title: page.title,
        rows: rows.filter((row) => page.matches(row.feature))
    }))
    const mapped = pages.reduce((count, page) => count + page.rows.length, 0)
    if (
        mapped !== rows.length ||
        pages.some((page) => page.rows.length === 0)
    ) {
        throw new Error('Migration appendix page routing is incomplete.')
    }
    return pages
}

/**
 * Builds the complete 1.0.17 to 1.1.0 migration index and guide.
 * @param {Record<string, any>[]} rows Feature rows.
 * @param {{ id: string, title: string, rows: Record<string, any>[] }[]} pages Appendix pages.
 * @returns {string} Markdown document.
 */
function migrationDocument(rows, pages) {
    const links = pages
        .map(
            (page) =>
                `- [${page.title} (${page.rows.length} mappings)](migration/${page.id}.md)`
        )
        .join('\n')
    return `# Migration from 1.0.17 to 1.1.0

## Breaking API convergence

Version 1.1.0 intentionally aligns CircuitJSON Toolkit with Gerber Toolkit,
Altium Toolkit, and KiCad Toolkit. Existing names and return shapes may change;
the previous behavior remains available through canonical services or the
explicit \`circuitjson-toolkit/extensions\` compatibility surface.

No feature in the 1.0.17 public baseline was silently removed. The generated
appendix pages map all ${rows.length} exports, methods, options, fields, and
observable behaviors to their 1.1.0 owner and record availability in all four
toolkits.

## Canonical root

The root exports these common classes:

- \`Parser\`
- \`ProjectLoader\`
- \`CircuitJsonDocumentContext\`
- \`PcbSvgRenderer\`
- \`SchematicSvgRenderer\`
- \`BomTableRenderer\`
- \`PcbInteractionIndex\`
- \`QueryService\`
- \`ManufacturingService\`
- \`SimulationService\`
- \`PcbScene3dBuilder\`
- \`PcbScene3dPreparator\`
- \`ToolkitCapabilities\`
- \`ToolkitError\`

\`CircuitJsonDocument\`, \`CircuitJsonIndexer\`, and \`CircuitJsonUnits\` remain
temporary root exports for \`pcb-scene3d-viewer\` compatibility. Other previous
root and renderer symbols moved to \`circuitjson-toolkit/extensions\`.

## Parser input and result

Before:

\`\`\`js
const model = CircuitJsonParser.parseText(text, { fileName: 'board.json' })
\`\`\`

After:

\`\`\`js
const document = Parser.parse({ fileName: 'board.json', data: text })
const model = document.model
\`\`\`

The common parser input is \`{ fileName, data, assets? }\`. Common options are
\`preserveRaw\`, \`decodeAssets\`, \`extensions\`, \`reports\`,
\`retainSource\`, \`worker\`, \`transferInput\`, \`signal\`, and
\`onProgress\`. Unsupported enum values fail instead of being coerced.

\`retainSource\` is exactly \`'none' | 'reference'\`. Reference mode adds the
exact caller input as a non-enumerable \`sourceReference\` on direct parser
results; it does not freeze that object and serialized results omit it.
Explicit worker execution rejects reference mode because cross-thread identity
cannot be preserved, while automatic execution stays direct.

\`Parser.parse\` returns \`ecad-toolkit.document.v1\` with exact top-level
\`schema\`, \`id\`, \`modelSchema\`, \`model\`, \`source\`, \`extensions\`,
\`assets\`, \`diagnostics\`, and \`statistics\` fields. \`Parser.tryParse\`
returns either \`{ ok: true, value }\` or
\`{ ok: false, error, diagnostics }\`.

## Project, rendering, query, manufacturing, simulation, and 3D

- \`ProjectLoader\` accepts named entry arrays and returns
  \`ecad-toolkit.project.v1\`. It captures known fields once, rejects an
  excessive entry count before inspecting records, and classifies that stable
  snapshot.
- Renderers accept a document, model, or prepared context and use common
  \`top\`/\`bottom\` sides.
- Reuse one \`CircuitJsonDocumentContext\` for repeated render, interaction,
  query, manufacturing, simulation, and scene work.
- \`PcbScene3dBuilder\` is synchronous and data-only.
  \`PcbScene3dPreparator\` performs explicit asynchronous asset resolution.
- Native source facts stay under \`document.extensions[format]\`; they are not
  duplicated into the CircuitJSON model.
- Missing native prerequisites and unsupported operations throw typed
  \`ToolkitError\` failures rather than returning invented empty results.

## Workers

\`Parser.parseAsync\` and \`ProjectLoader.loadAsync\` use the shared
\`ecad-toolkit.worker.v1\` protocol. Inputs are not detached unless
\`transferInput: true\`; worker-owned output buffers are transferred. Progress
uses ordered \`detect\`, \`decode\`, \`project\`, \`validate\`, and \`complete\`
stages. Cancellation is request-scoped.

## Package subpaths

- \`circuitjson-toolkit/parser\`
- \`circuitjson-toolkit/project\`
- \`circuitjson-toolkit/renderers\`
- \`circuitjson-toolkit/interaction\`
- \`circuitjson-toolkit/query\`
- \`circuitjson-toolkit/manufacturing\`
- \`circuitjson-toolkit/simulation\`
- \`circuitjson-toolkit/scene3d\`
- \`circuitjson-toolkit/capabilities\`
- \`circuitjson-toolkit/extensions\`
- \`circuitjson-toolkit/testing\`
- \`circuitjson-toolkit/workers/parser.worker.mjs\`
- \`circuitjson-toolkit/styles/renderers.css\`

## Exhaustive feature mapping

The exhaustive mapping is generated from the immutable captured contracts by
\`npm run sync:migration\`. The pages remain deterministic and each stays below
the repository's 1,000-line limit.

${links}
`
}

/**
 * Builds one generated appendix page.
 * @param {{ id: string, title: string, rows: Record<string, any>[] }} page Page descriptor.
 * @param {number} total Complete mapping count.
 * @returns {string} Markdown appendix page.
 */
function appendixDocument(page, total) {
    return `# ${page.title} migration mappings

This generated appendix contains ${page.rows.length} of the ${total} exhaustive
1.0.17 to 1.1.0 feature mappings. Regenerate it with
\`npm run sync:migration\`.

[Back to the migration guide](../migration.md)

${ledgerTables(page.rows)}
`
}

/**
 * Formats and writes one generated Markdown document.
 * @param {URL} path Output URL.
 * @param {string} markdown Unformatted Markdown.
 * @returns {Promise<void>}
 */
async function writeMarkdown(path, markdown) {
    await writeFile(
        path,
        await format(markdown, {
            parser: 'markdown',
            semi: false,
            singleQuote: true,
            tabWidth: 4,
            trailingComma: 'none'
        }),
        'utf8'
    )
}

/**
 * Generates the preservation catalogs, migration guide, and appendix pages.
 * @returns {Promise<void>}
 */
async function main() {
    const { ledger: rows } = await synchronizeFeaturePreservation()
    if (!Array.isArray(rows) || rows.some((row) => !row.feature)) {
        throw new TypeError('Feature preservation ledger is invalid.')
    }
    const pages = appendixPages(rows)
    await mkdir(APPENDIX_DIRECTORY_URL, { recursive: true })
    await Promise.all([
        writeMarkdown(OUTPUT_URL, migrationDocument(rows, pages)),
        ...pages.map((page) =>
            writeMarkdown(
                new URL(`${page.id}.md`, APPENDIX_DIRECTORY_URL),
                appendixDocument(page, rows.length)
            )
        )
    ])
}

await main()
