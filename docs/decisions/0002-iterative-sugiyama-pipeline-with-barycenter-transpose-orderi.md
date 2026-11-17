# Iterative Sugiyama Pipeline with Barycenter+Transpose Ordering and Dev-Only Dagre Oracle

Status: accepted (generated, pending human review)

## Context

Applications rendering pipeline, dependency, and state-machine graphs need a deterministic, dependency-free layered layout engine that guarantees zero node overlaps and exposes crossing counts, while matching or beating the crossing reduction quality of @dagrejs/dagre.

## Decision

Implement the five Sugiyama phases (iterative DFS cycle removal, longest-path layering, dummy-node normalization, barycenter plus adjacent-swap transpose ordering over 24 sweeps, and 4-pass median coordinate assignment with monotonic separation constraints) with zero runtime dependencies, using @dagrejs/dagre and fast-check strictly as devDependencies for conformance benchmarking and property verification.

## Consequences

The library has zero runtime dependencies, cannot overflow the call stack on deep graphs, guarantees overlap-free coordinates by construction, and deterministically achieves equal or fewer crossings than @dagrejs/dagre on proper-layered benchmarks.
