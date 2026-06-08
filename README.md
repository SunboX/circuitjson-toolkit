<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# CircuitJSON Toolkit

CircuitJSON Toolkit is an ESM JavaScript library for validating, parsing,
indexing, and inspecting serialized CircuitJSON element arrays.

The package was extracted from [ECAD Forge](https://ecadforge.app/), where it
is used as the shared CircuitJSON runtime utility layer between ECAD parsers,
viewer adapters, and browser-based import flows. It is intentionally separate
from `pcb-scene3d-viewer`, which owns Three.js rendering.

## Features

- Parse standalone CircuitJSON JSON text and bytes
- Validate serialized CircuitJSON element arrays
- Attach parser-style metadata such as `fileName`, `fileType`, `kind`, and
  `sourceFormat`
- Build lookup indexes by element type and stable CircuitJSON identifiers
- Resolve source component and PCB component maps for viewer or reporting
  integrations
- Convert CircuitJSON millimeter dimensions and points into mils for renderer
  adapters
- Run in browser and Node ESM environments
- Stay dependency-free at runtime and local-first by default

## Install

The package is published on npm as
[`circuitjson-toolkit`](https://www.npmjs.com/package/circuitjson-toolkit).

```bash
npm install circuitjson-toolkit
```

## Usage

```js
import {
    CircuitJsonDocument,
    CircuitJsonIndexer,
    CircuitJsonParser
} from 'circuitjson-toolkit'

const circuitJson = CircuitJsonParser.parseText(fileText)
CircuitJsonDocument.assertModel(circuitJson)

const index = CircuitJsonIndexer.index(circuitJson)
console.log(index.elementsByType.get('pcb_board'))
```

Parser-focused imports are also available through the `parser` subpath:

```js
import { CircuitJsonParser } from 'circuitjson-toolkit/parser'
```

## Documentation

- [API](docs/api.md)
- [Model Format](docs/model-format.md)
- [Testing](docs/testing.md)
- [Scope](spec/library-scope.md)

## Test

```bash
npm test
```

The test suite uses small fake CircuitJSON samples only. Do not add customer,
vendor, or source project documents to this repository.

## License

This project is available under two licensing options.

### 1. Open-source software license

GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).

You may use, modify, and distribute this project under the AGPL. If you
distribute modified versions, run modified versions as a network service, or
create larger works based on this project, they must comply with the AGPL,
including source-code availability requirements.

### 2. Commercial/proprietary license

For use in closed-source, proprietary, or otherwise AGPL-incompatible products,
a separate paid commercial license is required.

Commercial licensing contact: https://github.com/SunboX

### Documentation and notices

Documentation and non-code text are licensed under Creative Commons
Attribution-ShareAlike 4.0 (`CC-BY-SA-4.0`) unless otherwise marked.

Copyright (C) 2026 André Fiedler.

Copyright, license, attribution, and source-origin notices must be preserved as
required by the AGPL, CC-BY-SA-4.0, and the notice files in this repository.
See [LICENSE](LICENSE), [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md), and
[NOTICE.md](NOTICE.md).
