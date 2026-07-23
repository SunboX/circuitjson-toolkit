# circuitjson-toolkit 1.4.2

This patch release removes repeated immutable-graph work from toolkit-owned
document rebuilds and from cooperative structured-clone adoption. Public
document shapes, validation rules, cancellation behavior, and extension
selection semantics remain unchanged.

## Owned extension root reuse

- `DocumentResult.createValidated()` retains an extension namespace that was
  already captured, bounded, sealed, and branded by the same toolkit runtime.
- Rebuilding a canonical document no longer traverses or copies a large frozen
  native extension graph when only other document fields changed.
- Arbitrary caller objects still use the defensive validation and ownership
  path; frozen state alone never grants trusted ownership.

## Atomic cooperative finalization

- Cooperative structured-clone adoption validates a container's descriptors
  before freezing the container in one atomic operation.
- A yield can no longer expose a container with only some properties locked.
- Large graphs avoid one `defineProperty()` call per ordinary property while
  retaining the same deeply immutable result and cancellation checkpoints.

## Verification

- Ownership tests cover identity reuse for toolkit-built frozen namespaces and
  defensive behavior for untrusted objects.
- Cooperative snapshot tests prove that no partial property locking is visible
  across yields.
- The complete package suite, formatting check, packed-entrypoint checks, and
  npm dry-run gate the release.
