# Architecture

`@trysac/dag-layout-engine` implements the five classic Sugiyama layered graph layout phases deterministically and iteratively without runtime dependencies.

## Pipeline Phases

1. **Cycle Removal**: Iterative depth-first search over nodes in input order and outgoing edges in edge input order. Any edge leading to a vertex currently on the active DFS stack is marked as reversed so the working graph is a DAG.
2. **Layering**: Longest-path layering from sources via topological order. Source nodes are placed at layer `0`, and every other node is placed at `1 + max(predecessor.layer)`.
3. **Normalisation**: Edges spanning `k > 1` layers are split into `k` unit-length segments separated by `k - 1` zero-size (`width: 0, height: 0`) dummy vertices.
4. **Ordering (Crossing Reduction)**: Initial order per layer preserves real nodes in input order followed by dummy vertices in edge input order. The engine runs `sweeps` iterations alternating downward and upward passes using barycenter ordering (mean position of neighbors in the adjacent fixed layer) followed by adjacent-swap transpose while swaps strictly reduce crossings, retaining the best ordering observed.
5. **Coordinate Assignment**: Within each layer, vertices are initially packed left-to-right with `nodeSep` gaps, refined over 4 alternating downward and upward median-alignment sweeps that enforce `max(target, prevRight + nodeSep + width / 2)` so overlaps are impossible by construction, and shifted so the minimum left edge is `0`.
