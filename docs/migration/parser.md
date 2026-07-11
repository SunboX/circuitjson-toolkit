# Parser entrypoint migration mappings

This generated appendix contains 43 of the 1207 exhaustive
1.0.17 to 1.1.0 feature mappings. Regenerate it with
`npm run sync:migration`.

[Back to the migration guide](../migration.md)

## parse.document

| 1.0.17 feature                                                             | Kind   | Disposition | 1.1.0 replacement                                             | Availability                                                          |
| -------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| ./parser#CircuitJsonParser                                                 | export | shared      | circuitjson-toolkit/extensions#CircuitJsonParser              | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseBytes()                                    | method | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseBytes() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseBytes().argument.bytes                     | option | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseBytes() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseBytes().argument.options                   | option | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseBytes() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseBytes().argument.options.property.fileName | option | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseBytes() | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText()                                     | method | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().argument.options                    | option | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().argument.options.property.fileName  | option | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().argument.text                       | option | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().result.bom                          | field  | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().result.diagnostics                  | field  | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().result.fileName                     | field  | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().result.fileType                     | field  | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().result.kind                         | field  | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().result.manufacturing                | field  | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |
| ./parser#CircuitJsonParser.parseText().result.supportMatrix                | field  | shared      | circuitjson-toolkit/extensions#CircuitJsonParser.parseText()  | CircuitJSON: shared; Gerber: derived; Altium: derived; KiCad: derived |

## validation.document

| 1.0.17 feature                                                                         | Kind   | Disposition | 1.1.0 replacement                                        | Availability                                                       |
| -------------------------------------------------------------------------------------- | ------ | ----------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| ./parser#CircuitJsonDocument                                                           | export | shared      | circuitjson-toolkit#CircuitJsonDocument                  | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.assertModel()                                             | method | shared      | circuitjson-toolkit#CircuitJsonDocument.assertModel()    | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.assertModel().argument.value                              | option | shared      | circuitjson-toolkit#CircuitJsonDocument.assertModel()    | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata()                                          | method | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.circuitJson                     | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.metadata                        | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.metadata.property.bom           | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.metadata.property.diagnostics   | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.metadata.property.fileName      | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.metadata.property.fileType      | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.metadata.property.kind          | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.metadata.property.manufacturing | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().argument.metadata.property.supportMatrix | option | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().result.bom                               | field  | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().result.diagnostics                       | field  | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().result.fileName                          | field  | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().result.fileType                          | field  | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().result.kind                              | field  | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().result.manufacturing                     | field  | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().result.sourceFormat                      | field  | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.attachMetadata().result.supportMatrix                     | field  | shared      | circuitjson-toolkit#CircuitJsonDocument.attachMetadata() | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.isElement()                                               | method | shared      | circuitjson-toolkit#CircuitJsonDocument.isElement()      | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.isElement().argument.value                                | option | shared      | circuitjson-toolkit#CircuitJsonDocument.isElement()      | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.isModel()                                                 | method | shared      | circuitjson-toolkit#CircuitJsonDocument.isModel()        | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.isModel().argument.value                                  | option | shared      | circuitjson-toolkit#CircuitJsonDocument.isModel()        | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.validateModel()                                           | method | shared      | circuitjson-toolkit#CircuitJsonDocument.validateModel()  | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
| ./parser#CircuitJsonDocument.validateModel().argument.value                            | option | shared      | circuitjson-toolkit#CircuitJsonDocument.validateModel()  | CircuitJSON: shared; Gerber: shared; Altium: shared; KiCad: shared |
