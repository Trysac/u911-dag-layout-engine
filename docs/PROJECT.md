# Project

## Objective

Provide a small, deterministic, zero-dependency implementation of the Sugiyama layered graph layout algorithm with explicit crossing counts, guaranteed non-overlapping node placement, and standalone SVG rendering.

## Scope

- Cycle removal, longest-path layering, normalization, ordering (crossing reduction), and coordinate assignment.
- Input of directed graphs, SVG export, and crossing validation.

## Out of Scope

- Edge labels, ports, clusters and subgraphs.
- Advanced ranking heuristics like network-simplex.
- Incremental layout, splines, or automatic arrowhead generation.

## Factory run u911 (measured from API usage)

| Date (UTC) | Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|---|
| 2026-11-10 | generation | google/gemini-4-argon | yes | 6119 | 21490 | 0 | 0 | 0.4543 |
| 2026-11-11 | fix-1 | google/gemini-3.8-flash | no | 853177 | 6099 | 0 | 1301717 | 0.7604 |
| 2026-11-11 | fix-2 | google/gemini-3.8-flash | no | 531172 | 3125 | 0 | 1244460 | 0.5034 |
| 2026-11-11 | fix-3 | google/gemini-3.8-flash | no | 843117 | 4412 | 0 | 1486868 | 0.7604 |
| 2026-11-11 | fix-4 | google/gemini-3.8-flash | no | 859830 | 4103 | 0 | 1557006 | 0.7770 |
| 2026-11-17 | fix-1 | google/gemini-3.8-flash | no | 169923 | 1075 | 0 | 1579529 | 0.2499 |
| 2026-11-17 | audit | google/gemini-3.8-flash | no | 0 | 0 | 0 | 0 | 0.0000 |
| 2026-11-17 | docs | google/gemini-3.1-flash-lite | no | 24594 | 1338 | 0 | 0 | 0.0082 |

Total: $3.5136. Prices: vertex line, as measured by its adapter. Providers serve the current version of each model id, so the date tells which version answered; versions, launch stages and price sources per line are in the factory's model register (docs/MODELS.md).
