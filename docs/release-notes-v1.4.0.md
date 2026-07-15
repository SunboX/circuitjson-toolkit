# circuitjson-toolkit 1.4.0

This minor release removes redundant ownership work when a source toolkit or
browser worker has already established an exact graph provenance boundary. It
also lets browser hosts return control between validation and extension
sealing without changing the canonical result contract.

## Owned document construction

- `DocumentResult.createValidatedOwned(fields, runtime?)` creates the same
  validated `ecad-toolkit.document.v1` envelope as `createValidated()`.
- A source-toolkit convergence builder may transfer a newly constructed,
  standard-built-in graph into the envelope. Ordinary model and extension
  nodes retain their identities and are deeply frozen in place instead of
  being copied into a second full graph.
- The method is intentionally destructive. It is only safe when the toolkit
  exclusively owns the complete mutable graph and will not mutate it after the
  call. Arbitrary caller values, raw untrusted input, cross-realm objects,
  proxies, and altered prototypes must continue through `createValidated()`.
- Binary properties retain their defensive boundary and validation. Ownership
  limits, validation proofs, and immutable-envelope guarantees are unchanged.

## Cooperative structured-clone preparation

- `CircuitJsonDocumentContext.prepareStructuredCloneAsync(input, options?)`
  accepts the same structured-clone input and `indexes` option as the
  synchronous method, plus the required `ownership: 'exclusive'` declaration
  and an optional `yield` scheduler.
- This is a destructive transfer. Callers must relinquish every alias and
  shared-memory writer until settlement. Mutation before a node is acquired is
  outside the contract and cannot be detected reliably; rejection can leave a
  partially locked graph.
- The method validates and deeply freezes the model, then yields between
  bounded slices of dense-array traversal, Map/Set normalization, immutable
  text accounting, binary copying and installation, and property locking
  before sealing the canonical envelope.
- Acquired containers are shape-locked and their descriptors are checked while
  sealing. Individual plain extension records are capped at 16,384 properties
  so one record cannot create an unbounded cooperative inspection step.
- Existing immutable contexts are reused without a transfer declaration.
  Transferred ordinary records retain identity; dense arrays are normalized
  into clean arrays while preserving aliases and cycles, preventing unsupported
  hidden properties from leaking mutable state.
- An injected `yield` function is awaited at each scheduling boundary. Without
  one, the toolkit prefers `scheduler.yield()` and otherwise uses a zero-delay
  host task.
- The promise resolves to the same immutable `CircuitJsonDocumentContext`
  shape with the same indexes, caches, limits, and validation authority.

## Compatibility

- No parser option, package subpath, class, parameter, or return field is
  removed or renamed.
- `DocumentResult` remains `ecad-toolkit.document.v1`; its `model`, `source`,
  `extensions`, `assets`, `diagnostics`, and `statistics` fields are unchanged.
- `createValidatedOwned()` and `prepareStructuredCloneAsync()` are additive.
  The defensive and synchronous APIs retain their previous behavior.

## Verification and performance

Synthetic regression coverage verifies ordinary-record identity retention,
alias/cycle-preserving clean arrays, deep freeze, chunked text and binary
processing, dense-array and Map/Set scheduling,
cooperative yield ordering, progressive shape/property locking, the exclusive
ownership contract, and context reuse across document batches. The full
adversarial suite continues to cover hostile accessors, altered and cross-realm
built-ins, defensive binary ownership, worker parity, synchronous mutation
isolation, and bounded extension graphs.

On the same browser and machine, the exact large native-PCB deep link that
previously produced 3.29-second and 2.17-second renderer-main tasks retained
the same 25,729-element PCB SVG and view box after this release. A final fresh
open peaked at 17.7 milliseconds on the renderer main thread. A forced reload
peaked at 404.4 milliseconds, consisting of 196.8 milliseconds of browser
structured-clone deserialization plus 205.3 milliseconds of browser garbage
collection; no application JavaScript task approached the previous stalls.
The largest scheduled parser-worker task in that reload was 5.9 milliseconds.
A separate 150,000-record exclusive-adoption probe yielded 880 times and
completed in 487.35 milliseconds, with a 1.22-millisecond p95 slice and a
6.94-millisecond maximum outlier. A 32 MiB immutable-text probe completed in
8.13 milliseconds across 513 yields; a 32 MiB binary probe completed in 3.40
milliseconds across 514 yields. These figures describe fixed local workloads
and are not runtime guarantees; deterministic shape, validation, and ownership
tests remain the release gates.
