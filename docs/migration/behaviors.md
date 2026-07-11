# Observable behaviors migration mappings

This generated appendix contains 8 of the 1207 exhaustive
1.0.17 to 1.1.0 feature mappings. Regenerate it with
`npm run sync:migration`.

[Back to the migration guide](../migration.md)

## manufacturing.export

| 1.0.17 feature                                     | Kind     | Disposition | 1.1.0 replacement                                               | Availability                                                          |
| -------------------------------------------------- | -------- | ----------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| manufacturing downloads reject unsupported formats | behavior | shared      | circuitjson-toolkit/manufacturing#ManufacturingService.export() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |

## parse.document

| 1.0.17 feature                                     | Kind     | Disposition | 1.1.0 replacement                         | Availability                                                          |
| -------------------------------------------------- | -------- | ----------- | ----------------------------------------- | --------------------------------------------------------------------- |
| parser metadata survives structured cloning        | behavior | shared      | circuitjson-toolkit/parser#Parser.parse() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| parser rejects malformed JSON with SyntaxError     | behavior | shared      | circuitjson-toolkit/parser#Parser.parse() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| parser rejects non-CircuitJSON JSON with TypeError | behavior | shared      | circuitjson-toolkit/parser#Parser.parse() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |

## query.document

| 1.0.17 feature                                   | Kind     | Disposition | 1.1.0 replacement                               | Availability                                                       |
| ------------------------------------------------ | -------- | ----------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| indexer builds deterministic type and id lookups | behavior | shared      | circuitjson-toolkit/query#QueryService.create() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |

## render.pcb

| 1.0.17 feature                                            | Kind     | Disposition | 1.1.0 replacement                                     | Availability                                                          |
| --------------------------------------------------------- | -------- | ----------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| PCB renderer selects top or bottom side deterministically | behavior | shared      | circuitjson-toolkit/renderers#PcbSvgRenderer.render() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |

## simulation.spice

| 1.0.17 feature                                                   | Kind     | Disposition | 1.1.0 replacement                                      | Availability                                                          |
| ---------------------------------------------------------------- | -------- | ----------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| SPICE simulation returns deterministic transient graph summaries | behavior | shared      | circuitjson-toolkit/simulation#SimulationService.run() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |

## validation.document

| 1.0.17 feature                          | Kind     | Disposition | 1.1.0 replacement                                           | Availability                                                       |
| --------------------------------------- | -------- | ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| validator rejects unknown element types | behavior | shared      | circuitjson-toolkit/parser#DocumentResult.createValidated() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
