# circuitjson-toolkit 1.3.0

## Faster canonical extension ownership

This minor release adds an explicit fast ownership path for large native
extension graphs received through the platform structured-clone algorithm.
Ordinary records, arrays, and standard local data containers are classified
without deliberately invoking incompatible intrinsic getters, while genuine
buffers and views still use captured platform slots as the final authority.

The new `CircuitJsonDocumentContext.prepareStructuredClone(document, options?)`
method has the same options and return shape as `prepare()`. It is intended for
the exact result of a completed platform structured clone, or for a graph
created entirely by the toolkit after that boundary. Hosts must continue to use
`prepare()` for arbitrary caller-owned, cross-realm, proxy-backed, or
prototype-modified input. The optimization is source-format-neutral and
requires no example-specific handling.

Measured on the deterministic standard-built-in metadata workload used during
development, capturing 50,000 populated records fell from about 3.7 seconds to
about 0.16 seconds. Browser timing for the combined library and ECAD Forge
release is documented by the application release because network transfer,
application interaction preparation, and SVG mounting are outside this
library's ownership boundary.

## Compatibility and API changes

- No public class, package subpath, parameter, or return field is removed or
  renamed.
- `CircuitJsonDocumentContext.prepareStructuredClone(document, options?)` is a
  new opt-in method for the explicit structured-clone provenance contract.
- Parser, project, renderer, worker, and extension result shapes are unchanged.
- The existing `prepare()` path remains exact and prototype-independent.
  Cross-realm and altered-prototype `ArrayBuffer`, `SharedArrayBuffer`, typed
  array, and `DataView` values, resizable buffers, byte ceilings, and
  defensive-copy behavior are retained.
- Proven standard plain-data graphs no longer generate caught exceptions merely
  to prove that each ordinary node is not binary data.

The new regression coverage pauses on every thrown exception in an isolated
runtime, proving that a representative proven-standard metadata graph completes
with zero binary-probe exceptions. Exact-path regressions cover altered and
cross-realm binary objects plus proxy prototype traps. Existing adversarial and
full-suite contracts continue to cover hostile accessors, worker parity,
mutation isolation, and bounded extension ownership.
