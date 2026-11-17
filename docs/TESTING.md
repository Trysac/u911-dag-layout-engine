# Testing

## Unit & Acceptance Tests (`test/index.test.ts`)

- Verifies output for specific chain topologies (center coordinates, layering, edge points).
- Tests cyclic graph handling via DFS-based reversal.
- Validates crossing counts for specific K_2,2 bipartite graph configurations.
- Checks SVG output accuracy and character escaping.
- Verifies all `LayoutError` codes (`duplicate_node`, `unknown_node`, `self_loop`, `invalid_size`, `too_large`).

## Property Tests (`test/index.test.ts`)

- Uses `fast-check` (seed 7, 200 runs) to verify that for random graphs up to 30 nodes, the output contains no intersecting node rectangles and respects `nodeSep` constraints.

## Conformance Tier (`test/dagre.conformance.test.ts`)

- Runs 50 seeded `mulberry32` proper-layered graph test cases.
- Compares total crossing counts against `@dagrejs/dagre` 1.x output.
- Verifies zero node overlaps on all generated layouts.
