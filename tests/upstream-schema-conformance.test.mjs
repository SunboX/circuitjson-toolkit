import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { any_circuit_element as upstreamElement } from 'circuit-json'

import { CircuitJsonDocument } from '../src/core/CircuitJsonDocument.mjs'
import { CircuitJsonElementValidator } from '../src/core/CircuitJsonElementValidator.mjs'
import { CircuitJsonIndexer } from '../src/core/CircuitJsonIndexer.mjs'
import { Parser } from '../src/core/Parser.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { CIRCUIT_JSON_UPSTREAM_PROVENANCE } from '../src/core/CircuitJsonUpstreamSchema.mjs'

const repositoryRoot = new URL('../', import.meta.url)

const acceptedWarnings = [
    {
        type: 'source_refdes_convention_warning',
        message: 'Reference prefix differs from the convention.',
        source_component_id: 'source_component_1',
        refdes: 'X1',
        source_component_ftype: 'simple_resistor',
        expected_prefixes: ['R']
    },
    {
        type: 'source_unnamed_trace_warning',
        message: 'Trace has no name.',
        source_trace_id: 'source_trace_1'
    },
    {
        type: 'source_part_not_found_warning',
        message: 'Requested part was not found.'
    }
]

const completeDomainSamples = [
    {
        valid: {
            type: 'source_net',
            source_net_id: 'source_net_1',
            name: 'VCC',
            member_source_group_ids: []
        },
        invalid: {
            type: 'source_net',
            source_net_id: 'source_net_1',
            name: 'VCC'
        }
    },
    {
        valid: {
            type: 'schematic_text',
            schematic_text_id: 'schematic_text_1',
            text: 'VCC',
            position: { x: 0, y: 0 }
        },
        invalid: {
            type: 'schematic_text',
            schematic_text_id: 'schematic_text_1',
            text: 'VCC'
        }
    },
    {
        valid: { type: 'pcb_trace', route: [] },
        invalid: { type: 'pcb_trace' }
    },
    {
        valid: {
            type: 'cad_component',
            cad_component_id: 'cad_component_1',
            pcb_component_id: 'pcb_component_1',
            source_component_id: 'source_component_1',
            position: { x: 0, y: 0, z: 0 }
        },
        invalid: {
            type: 'cad_component',
            cad_component_id: 'cad_component_1',
            pcb_component_id: 'pcb_component_1',
            source_component_id: 'source_component_1'
        }
    },
    {
        valid: {
            type: 'simulation_experiment',
            name: 'Transient',
            experiment_type: 'spice_transient_analysis'
        },
        invalid: { type: 'simulation_experiment', name: 'Transient' }
    }
]

test('canonical element union includes every pinned upstream warning and excludes local aliases', () => {
    for (const warning of acceptedWarnings) {
        assert.equal(upstreamElement.safeParse(warning).success, true)
        assert.equal(CircuitJsonDocument.isElement(warning), true)
    }

    for (const type of [
        'pcb_courtyard',
        'pcb_courtyard_line',
        'pcb_courtyard_path'
    ]) {
        const value = { type, [`${type}_id`]: `${type}_1` }
        assert.equal(upstreamElement.safeParse(value).success, false)
        assert.equal(CircuitJsonDocument.isElement(value), false)
    }
})

test('canonical validation enforces complete upstream schemas across every domain', () => {
    for (const { valid, invalid } of completeDomainSamples) {
        assert.equal(upstreamElement.safeParse(valid).success, true, valid.type)
        assert.equal(CircuitJsonDocument.isElement(valid), true, valid.type)
        assert.equal(
            upstreamElement.safeParse(invalid).success,
            false,
            invalid.type
        )
        assert.equal(
            CircuitJsonDocument.isElement(invalid),
            false,
            invalid.type
        )
    }
})

test('generated schema contract proves exact pinned upstream provenance', async () => {
    const source = JSON.parse(
        await readFile(
            new URL('spec/circuitjson-schema-source.json', repositoryRoot),
            'utf8'
        )
    )
    const snapshot = JSON.parse(
        await readFile(
            new URL('spec/circuitjson-schema-snapshot.json', repositoryRoot),
            'utf8'
        )
    )

    assert.equal(source.package, 'circuit-json')
    assert.equal(source.version, '0.0.446')
    assert.match(source.integrity, /^sha512-/u)
    assert.match(source.distributionSha256, /^[a-f0-9]{64}$/u)
    assert.match(source.contractSha256, /^[a-f0-9]{64}$/u)
    assert.deepEqual(
        source.compilerDependencies.map((dependency) => ({
            package: dependency.package,
            version: dependency.version,
            distributionFile: dependency.distributionFile
        })),
        [
            {
                package: 'format-si-unit',
                version: '0.0.7',
                distributionFile: 'dist/index.js'
            },
            {
                package: 'zod',
                version: '3.25.76',
                distributionFile: 'index.js'
            }
        ]
    )
    for (const dependency of source.compilerDependencies) {
        assert.match(dependency.integrity, /^sha512-/u)
        assert.match(dependency.distributionSha256, /^[a-f0-9]{64}$/u)
    }
    assert.deepEqual(
        CIRCUIT_JSON_UPSTREAM_PROVENANCE.compilerDependencies,
        source.compilerDependencies
    )
    assert.equal(snapshot.elementTypes.length > 100, true)
    assert.deepEqual(
        CircuitJsonElementValidator.knownElementTypes(),
        snapshot.elementTypes
    )
    assert.equal(snapshot.elementTypes.includes('pcb_courtyard'), false)
    assert.equal(
        snapshot.elementTypes.includes('source_refdes_convention_warning'),
        true
    )
})

test('serialized-input acceptance keeps random upstream defaults unmaterialized and visible', () => {
    const document = Parser.parse({
        fileName: 'default-id.json',
        data: JSON.stringify([{ type: 'pcb_trace', route: [] }])
    })

    assert.equal(Object.hasOwn(document.model[0], 'pcb_trace_id'), false)
    assert.equal(document.diagnostics.length, 1)
    assert.equal(
        document.diagnostics[0].code,
        'CIRCUITJSON_UPSTREAM_DEFAULT_ID_OMITTED'
    )
    assert.deepEqual(document.statistics, {
        upstreamDefaultIdentityOmissions: 1
    })
    assert.equal(CircuitJsonIndexer.getElementId(document.model[0]), '')
    assert.doesNotThrow(() => CircuitJsonDocumentContext.prepare(document))

    const stable = Parser.parse({
        fileName: 'stable-id.json',
        data: JSON.stringify([
            { type: 'pcb_trace', pcb_trace_id: 'trace_1', route: [] }
        ])
    })
    assert.deepEqual(stable.diagnostics, [])
    assert.deepEqual(stable.statistics, {})
    assert.equal(CircuitJsonIndexer.getElementId(stable.model[0]), 'trace_1')
})

test('schema synchronization derives from upstream and never imports the local validator', async () => {
    const syncSource = await readFile(
        new URL('scripts/sync-circuit-json-schema.mjs', repositoryRoot),
        'utf8'
    )
    assert.match(syncSource, /from 'circuit-json'/u)
    assert.doesNotMatch(syncSource, /CircuitJsonElementValidator/u)
})
