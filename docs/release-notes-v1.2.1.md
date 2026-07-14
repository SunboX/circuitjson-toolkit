# circuitjson-toolkit 1.2.1

## Large canonical worker results

This patch release keeps valid high-fidelity documents and multi-document
projects inside explicit, format-neutral worker limits:

- Selected native extensions may contain up to 4,000,000 structured items and
  128 MiB of string or binary content.
- A canonical standalone document may contain up to 5,000,000 result values
  within the existing 250 MB byte ceiling.
- An exact canonical project may contain up to 8,000,000 aggregate values and
  256 MiB, while every document retains its own 5,000,000-value and 250 MB
  limits.
- Non-document project metadata retains the generic 2,000,000-value and 250 MB
  limits.

Elevated budgets require the complete canonical document or project envelope;
a schema string alone does not change generic result limits. Reused object
graphs are charged independently to document and project-metadata scopes in a
property-order-independent way. Repeated alias-accounting work is also capped
by the project aggregate budget, keeping transport time bounded.

No public class, method, package subpath, parameter, or result field is removed
or renamed. Oversized results continue to fail visibly rather than being
truncated.
