# Testing and downstream conformance

## Repository gates

```bash
npm ci
npm test
npm run check:format
npm run sync:schema -- --check
npm run check:features -- --strict
npm run benchmark -- --compare benchmarks/baseline-v1.0.17.json
npm pack --dry-run
npm run check:packed-entrypoints
npm run check:browser-dependencies
```

`sync:schema -- --check` recompiles the complete element union from the pinned
development dependency `circuit-json@0.0.446` and compares its contract hash,
schema snapshot, provenance, and browser-neutral generated validator with the
checked-in artifacts. Check mode is read-only. It also preserves upstream
transform rejection boundaries, including malformed SI-unit strings that the
upstream schema rejects by throwing instead of returning a failed parse.

The schema differential suite samples every upstream union leaf, compares
required-field failures, exercises transform-owned resistor, capacitor,
inductor, current-source, and crystal fields, and verifies that a fresh compile
is exactly equal to the generated runtime contract. Unsupported future Zod
constructs fail the compiler closed.

`check:features -- --strict` packs the package, imports its public entrypoints,
checks every 1.0.17 ledger row against the capability inventory, and verifies
all referenced test and documentation paths.

The benchmark comparison freezes historical workload semantics, fixtures,
expected results, clone bytes, environment metadata, samples, medians, and
checksums. Candidate timing is the median of at least three independent Node
processes. Each process imports the toolkit runtime from the freshly extracted
npm package candidate rather than the live worktree. Its execution marker must
match the candidate package version and packed-source digest; candidate
provenance additionally records the fresh tarball SHA-256.
Primary convergence cases must improve by the release threshold; unchanged
cases may not exceed their regression budgets. The enforced limits are 20%
faster for both primary cases, at most 5% regression for other large cases, at
most 10% for small cases, and at least 25% fewer clone bytes for the duplicate
index graph.

The two packed checks always create and install a fresh npm pack in isolated
fixtures. If an explicit tarball is supplied, its digest must equal that fresh
pack, so a stale retained candidate cannot pass. The
entrypoint gate imports every documented subpath and runs the complete shared
contract. The browser graph gate starts at every JavaScript, worker, and CSS
export, follows packed relative imports, and rejects Node built-ins,
`circuit-json`, undeclared packages, and development-only runtime edges.

## Shared toolkit contract

Source toolkits consume the packed harness:

```js
import {
    ToolkitContractFixtures,
    runToolkitContract
} from 'circuitjson-toolkit/testing'
import * as toolkit from 'gerber-toolkit'

const report = await runToolkitContract(toolkit, {
    fixtures: ToolkitContractFixtures.gerber()
})

assert.deepEqual(report.failures, [])
```

Fixtures are available for CircuitJSON, Gerber, Altium, and KiCad. The harness
checks the exact canonical class list, parser and project success/failure
paths, synchronous/asynchronous equivalence, document result shapes, context
reuse, top/bottom rendering, interaction, query, manufacturing, simulation,
3D scenes, typed errors, and common capability ids.

Worker checks install an in-memory `ecad-toolkit.worker.v1` loopback with real
structured-clone and transfer boundaries, then require `worker: true`. A direct
fallback cannot satisfy these checks.

Queue regressions hold one worker operation active while parser and project
requests wait behind it. They mutate default-mode caller buffers and require
the original request snapshot, then verify explicit-transfer buffers detach
only after admission and preserve shared backing-buffer aliases.

Extension ownership tests use a realistic native graph above the former
compact-metadata item ceiling. They require one bounded immutable capture,
mutation isolation, a direct capture under two seconds, exact worker-result
round-trip behavior, and visible rejection beyond the separate 128 MiB
extension payload ceiling. A 3 MiB binary regression additionally requires
byte-backed `Uint8Array` shape, defensive-copy mutation isolation, direct and
worker parity, bounded elapsed time, and bounded JavaScript heap growth.

Variant-geometry tests also lock rotation-local polygon-plated pad extents and
pill drill dimensions, independent outer/drill rotations, and every legal
outer-size field so Gerber, KiCad, Altium, and viewers share the same hole
primitive contract. Legal square holes remain rectangular apertures.

ZIP tests reject local/central filename, CRC32, and size disagreements, then
verify extracted bytes for both stored and deflated members. A same-length
payload bit flip must fail CRC32 verification instead of reaching a format
parser.

Async ownership tests mutate exact-window `SharedArrayBuffer` parser/project
bytes, attached assets, and companion assets from the first progress callback.
Sync, direct async, and structured-clone worker results must remain identical,
and prepared companion assets must not be copied a second time at result build.

The harness reads capability status before invoking optional behavior. A
`shared`, `native`, or `derived` operation must return its canonical result; an
`unavailable` operation must throw `ToolkitError` with
`ERR_CAPABILITY_UNAVAILABLE`. This lets a source format explicitly reject work
it cannot represent instead of returning an invented empty success.

Each source repository also owns format-specific differential, worker,
cancellation, transfer, native-fidelity, extension, and performance tests.

Core convergence tests additionally exercise copy-on-write and owned legacy
normalization, exact geometry preservation, singular/plural diagnostic
relations, and worker-received native extensions. Performance gates cover
50,000-element parse and index preparation, repeated hit testing, multi-side
rendering, and clone allocation so compatibility does not add an
application-visible slow path.

## Fixture policy

Use only small synthetic, obfuscated, repository-owned samples. Never commit
customer, vendor, or source project files. Fixes must derive from the format,
schema, or protocol rather than sample names or known text.
