import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { z } from 'zod'

import { any_circuit_element as upstreamElement } from 'circuit-json'

import { CircuitJsonUpstreamSchemaCompiler } from '../scripts/CircuitJsonUpstreamSchemaCompiler.mjs'
import { CircuitJsonDocument } from '../src/core/CircuitJsonDocument.mjs'
import {
    CIRCUIT_JSON_UPSTREAM_CONTRACT_SCHEMA,
    CIRCUIT_JSON_UPSTREAM_DEFAULT_ID_FIELDS,
    CIRCUIT_JSON_UPSTREAM_ELEMENT_TYPES,
    CIRCUIT_JSON_UPSTREAM_ID_FIELD_EXCEPTIONS,
    CIRCUIT_JSON_UPSTREAM_SCHEMAS,
    CIRCUIT_JSON_UPSTREAM_STATISTICS,
    CIRCUIT_JSON_UPSTREAM_VARIANT_SETS
} from '../src/core/CircuitJsonUpstreamSchema.mjs'

const OMIT = Symbol('omit')
const repositoryRoot = new URL('../', import.meta.url)

/** @param {unknown} value Element candidate. @returns {boolean} Pinned acceptance. */
function upstreamAccepts(value) {
    try {
        return upstreamElement.safeParse(value).success
    } catch {
        return false
    }
}

/** @returns {Record<string, any>} Generated browser contract body. */
function generatedContract() {
    return {
        schema: CIRCUIT_JSON_UPSTREAM_CONTRACT_SCHEMA,
        elementTypes: CIRCUIT_JSON_UPSTREAM_ELEMENT_TYPES,
        schemas: CIRCUIT_JSON_UPSTREAM_SCHEMAS,
        defaultIdFields: CIRCUIT_JSON_UPSTREAM_DEFAULT_ID_FIELDS,
        idFieldExceptions: CIRCUIT_JSON_UPSTREAM_ID_FIELD_EXCEPTIONS,
        variantSets: CIRCUIT_JSON_UPSTREAM_VARIANT_SETS,
        statistics: CIRCUIT_JSON_UPSTREAM_STATISTICS
    }
}

/** @param {any} schema Zod schema. @returns {any[]} Outer element leaves. */
function elementLeaves(schema) {
    const typeName = schema._def.typeName
    if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
        return [...schema._def.options].flatMap(elementLeaves)
    }
    if (
        typeName === 'ZodEffects' &&
        ['ZodUnion', 'ZodDiscriminatedUnion'].includes(
            schema._def.schema._def.typeName
        )
    ) {
        return elementLeaves(schema._def.schema)
    }
    return [schema]
}

/** @param {any} schema Zod schema. @returns {any} Minimal accepted input. */
function sample(schema) {
    const definition = schema._def
    switch (definition.typeName) {
        case 'ZodAny':
        case 'ZodUnknown':
            return null
        case 'ZodBoolean':
            return false
        case 'ZodString': {
            if (definition.checks.some((check) => check.kind === 'endsWith')) {
                return '1mAh'
            }
            if (definition.checks.some((check) => check.kind === 'datetime')) {
                return '2026-07-11T00:00:00Z'
            }
            return 'value'
        }
        case 'ZodNumber': {
            let value = 0
            for (const check of definition.checks) {
                if (check.kind === 'min' && value <= check.value) {
                    value = check.inclusive ? check.value : check.value + 1
                }
                if (check.kind === 'max' && value >= check.value) {
                    value = check.inclusive ? check.value : check.value - 1
                }
            }
            return value
        }
        case 'ZodLiteral':
            return definition.value
        case 'ZodEnum':
            return definition.values[0]
        case 'ZodOptional':
        case 'ZodDefault':
            return OMIT
        case 'ZodNullable':
            return null
        case 'ZodArray': {
            const length =
                definition.exactLength?.value ??
                definition.minLength?.value ??
                0
            return Array.from({ length }, () => sample(definition.type))
        }
        case 'ZodTuple':
            return definition.items.map(sample)
        case 'ZodRecord':
            return {}
        case 'ZodObject': {
            const value = {}
            for (const [key, field] of Object.entries(definition.shape())) {
                const fieldSample = sample(field)
                if (fieldSample !== OMIT) value[key] = fieldSample
            }
            return value
        }
        case 'ZodUnion':
        case 'ZodDiscriminatedUnion': {
            for (const option of definition.options) {
                const candidate = sample(option)
                if (candidate !== OMIT && option.safeParse(candidate).success) {
                    return candidate
                }
            }
            throw new Error('Could not sample upstream union.')
        }
        case 'ZodEffects': {
            const value = sample(definition.schema)
            return refinedSample(value)
        }
        case 'ZodPipeline': {
            const value = sample(definition.in)
            return value === OMIT ? 0.5 : value
        }
        case 'ZodNever':
            throw new Error('ZodNever has no sample.')
        default:
            throw new Error(
                `Unsupported sample construct: ${definition.typeName}`
            )
    }
}

/** @param {any} value Effects input. @returns {any} Refinement-safe value. */
function refinedSample(value) {
    if (!value || typeof value !== 'object') return value
    if (value.type === 'simulation_voltage_probe') {
        value.signal_input_source_port_id = 'source_port_1'
    }
    if (value.type === 'simulation_current_probe') {
        value.positive_source_port_id = 'source_port_1'
        value.negative_source_port_id = 'source_port_2'
    }
    if (value.type === 'simulation_oscilloscope_trace') {
        value.simulation_voltage_probe_id = 'simulation_voltage_probe_1'
    }
    return value
}

/** @param {any} schema Element schema. @returns {string[]} Required keys. */
function requiredKeys(schema) {
    while (schema._def.typeName === 'ZodEffects') schema = schema._def.schema
    if (schema._def.typeName !== 'ZodObject') return []
    return Object.entries(schema._def.shape())
        .filter(
            ([key, field]) =>
                key !== 'type' &&
                !['ZodOptional', 'ZodDefault'].includes(field._def.typeName)
        )
        .map(([key]) => key)
}

test('generated validator matches pinned upstream across every schema leaf', () => {
    const leaves = elementLeaves(upstreamElement)
    assert.equal(leaves.length > 100, true)

    for (const [index, leaf] of leaves.entries()) {
        const valid = refinedSample(sample(leaf))
        const upstreamValid = upstreamElement.safeParse(valid).success
        assert.equal(upstreamValid, true, `upstream leaf ${index}`)
        assert.equal(
            CircuitJsonDocument.isElement(valid),
            upstreamValid,
            `local leaf ${index}: ${valid.type}`
        )

        const required = requiredKeys(leaf)[0]
        if (!required) continue
        const invalid = structuredClone(valid)
        delete invalid[required]
        assert.equal(
            CircuitJsonDocument.isElement(invalid),
            upstreamElement.safeParse(invalid).success,
            `required ${invalid.type}.${required}`
        )
    }
})

test('generated validator preserves upstream transform rejection boundaries', () => {
    const cases = [
        {
            type: 'source_component',
            source_component_id: 'source_resistor_1',
            name: 'R1',
            ftype: 'simple_resistor',
            resistance: ''
        },
        {
            type: 'source_component',
            source_component_id: 'source_capacitor_1',
            name: 'C1',
            ftype: 'simple_capacitor',
            capacitance: '1 '
        },
        {
            type: 'source_component',
            source_component_id: 'source_inductor_1',
            name: 'L1',
            ftype: 'simple_inductor',
            inductance: ''
        },
        {
            type: 'source_component',
            source_component_id: 'source_current_1',
            name: 'I1',
            ftype: 'simple_current_source',
            current: ' '
        },
        {
            type: 'source_component',
            source_component_id: 'source_crystal_1',
            name: 'Y1',
            ftype: 'simple_crystal',
            frequency: ''
        }
    ]

    for (const value of cases) {
        assert.equal(upstreamAccepts(value), false, value.ftype)
        assert.equal(CircuitJsonDocument.isElement(value), false, value.ftype)
    }

    const accepted = { ...cases[0], resistance: 'not-a-unit' }
    assert.equal(upstreamAccepts(accepted), true)
    assert.equal(CircuitJsonDocument.isElement(accepted), true)
})

test('generated contract exactly matches a fresh compile of the pinned union', async () => {
    const compiled = CircuitJsonUpstreamSchemaCompiler.compile(upstreamElement)
    const source = JSON.parse(
        await readFile(
            new URL('spec/circuitjson-schema-source.json', repositoryRoot),
            'utf8'
        )
    )

    assert.equal(
        CircuitJsonUpstreamSchemaCompiler.checksum(compiled),
        source.contractSha256
    )
    assert.deepEqual(generatedContract(), compiled)
})

test('schema check mode verifies drift without writing generated artifacts', async () => {
    const synchronization =
        await import('../scripts/sync-circuit-json-schema.mjs')
    assert.equal(
        typeof synchronization.assertCircuitJsonSchemaArtifacts,
        'function'
    )

    const expected = {
        source: { contractSha256: 'expected' },
        snapshot: { elementTypes: ['source_net'] },
        generatedSource: 'generated\n'
    }
    assert.doesNotThrow(() =>
        synchronization.assertCircuitJsonSchemaArtifacts(expected, expected)
    )
    assert.throws(
        () =>
            synchronization.assertCircuitJsonSchemaArtifacts(
                { ...expected, generatedSource: 'stale\n' },
                expected
            ),
        /CircuitJSON schema artifacts are out of sync/u
    )

    const output = execFileSync(
        process.execPath,
        ['scripts/sync-circuit-json-schema.mjs', '--check'],
        { cwd: new URL('.', repositoryRoot) }
    ).toString()
    assert.match(output, /verified without writing/u)
})

test('upstream compiler fails closed on unsupported Zod constructs', () => {
    const unsupported = z.union([
        z.object({ type: z.literal('future_element'), createdAt: z.date() })
    ])
    assert.throws(
        () => CircuitJsonUpstreamSchemaCompiler.compile(unsupported),
        /Unsupported upstream Zod construct: ZodDate/u
    )
})
