/**
 * Public entry point of @trysac/dag-layout-engine.
 *
 * Sugiyama layered graph layout written by hand: cycle removal, longest-path
 * layers, barycenter crossing reduction, overlap-free coordinates and SVG output.
 */

/**
 * Machine-readable error codes raised by {@link LayoutError}.
 */
export type LayoutErrorCode =
  | "duplicate_node"
  | "unknown_node"
  | "self_loop"
  | "invalid_size"
  | "invalid_option"
  | "too_large";

/**
 * Typed error raised when graph inputs, layout structures or options violate constraints.
 */
export class LayoutError extends Error {
  public readonly code: LayoutErrorCode;

  public constructor(code: LayoutErrorCode, message: string) {
    super(message.slice(0, 200));
    this.name = "LayoutError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Input node descriptor.
 */
export interface InputNode {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly label?: string;
}

/**
 * Input directed edge descriptor.
 */
export interface InputEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * Input graph with nodes and directed edges.
 */
export interface InputGraph {
  readonly nodes: readonly InputNode[];
  readonly edges: readonly InputEdge[];
}

/**
 * Layout configuration options.
 */
export interface LayoutOptions {
  readonly direction?: "TB" | "LR";
  readonly rankSep?: number;
  readonly nodeSep?: number;
  readonly sweeps?: number;
  readonly maxNodes?: number;
  readonly maxEdges?: number;
}

/**
 * 2D Cartesian point.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Positioned node in a computed {@link Layout}.
 * `x` and `y` denote the centre of the node.
 */
export interface LayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly layer: number;
  readonly order: number;
  readonly label?: string;
}

/**
 * Routed edge in a computed {@link Layout}.
 * `points` are ordered from the original source (`from`) to the original target (`to`).
 */
export interface LayoutEdge {
  readonly from: string;
  readonly to: number extends never ? never : string;
  readonly points: readonly Point[];
  readonly reversed: boolean;
}

/**
 * Computed layered layout.
 */
export interface Layout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly width: number;
  readonly height: number;
}

const DEFAULT_DIRECTION: "TB" | "LR" = "TB";
const DEFAULT_RANK_SEP = 50;
const DEFAULT_NODE_SEP = 20;
const DEFAULT_SWEEPS = 24;
const DEFAULT_MAX_NODES = 2_000;
const DEFAULT_MAX_EDGES = 10_000;
const MAX_DUMMY_NODES = 100_000;

interface ValidatedOptions {
  readonly direction: "TB" | "LR";
  readonly rankSep: number;
  readonly nodeSep: number;
  readonly sweeps: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
}

function safeIdPreview(value: unknown): string {
  const str = String(value);
  return str.length > 40 ? `${str.slice(0, 40)}...` : str;
}

function validateOptions(opts?: LayoutOptions): ValidatedOptions {
  if (opts !== undefined && (typeof opts !== "object" || opts === null)) {
    throw new LayoutError("invalid_option", "Options must be an object");
  }
  const direction = opts?.direction ?? DEFAULT_DIRECTION;
  if (direction !== "TB" && direction !== "LR") {
    throw new LayoutError("invalid_option", `Invalid direction: ${safeIdPreview(direction)}`);
  }

  const rankSep = opts?.rankSep ?? DEFAULT_RANK_SEP;
  if (typeof rankSep !== "number" || !Number.isFinite(rankSep) || rankSep < 0) {
    throw new LayoutError("invalid_option", "rankSep must be a finite non-negative number");
  }

  const nodeSep = opts?.nodeSep ?? DEFAULT_NODE_SEP;
  if (typeof nodeSep !== "number" || !Number.isFinite(nodeSep) || nodeSep < 0) {
    throw new LayoutError("invalid_option", "nodeSep must be a finite non-negative number");
  }

  const sweeps = opts?.sweeps ?? DEFAULT_SWEEPS;
  if (typeof sweeps !== "number" || !Number.isInteger(sweeps) || sweeps < 0 || sweeps > 10_000) {
    throw new LayoutError("invalid_option", "sweeps must be a non-negative integer at most 10000");
  }

  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;
  if (typeof maxNodes !== "number" || !Number.isInteger(maxNodes) || maxNodes < 0) {
    throw new LayoutError("invalid_option", "maxNodes must be a non-negative integer");
  }

  const maxEdges = opts?.maxEdges ?? DEFAULT_MAX_EDGES;
  if (typeof maxEdges !== "number" || !Number.isInteger(maxEdges) || maxEdges < 0) {
    throw new LayoutError("invalid_option", "maxEdges must be a non-negative integer");
  }

  return {
    direction,
    rankSep,
    nodeSep,
    sweeps,
    maxNodes,
    maxEdges,
  };
}

interface InternalVertex {
  readonly vIndex: number;
  readonly isDummy: boolean;
  readonly inputNodeIndex: number; // -1 for dummy
  readonly layer: number;
  readonly spanW: number; // extent along within-layer axis (width in TB, height in LR)
  readonly bandH: number; // extent along across-layer axis (height in TB, width in LR)
  readonly downNeighbors: number[];
  readonly upNeighbors: number[];
}

interface EdgeChain {
  readonly edgeIndex: number;
  readonly reversed: boolean;
  readonly dagU: number; // input node index in upper layer
  readonly dagV: number; // input node index in lower layer
  readonly chainVertices: readonly number[]; // [dagU_vIndex, ...dummy_vIndices, dagV_vIndex]
}

/**
 * Counts segment crossings between adjacent layers (including dummy vertices)
 * in a computed {@link Layout}.
 *
 * @param l - Computed layout object.
 * @returns Total number of crossings across all adjacent layer pairs.
 * @throws {LayoutError} When the layout input is malformed or exceeds size limits.
 */
export function countCrossings(l: Layout): number {
  if (typeof l !== "object" || l === null || !Array.isArray(l.nodes) || !Array.isArray(l.edges)) {
    throw new LayoutError("invalid_option", "Invalid layout object");
  }
  if (l.nodes.length > DEFAULT_MAX_NODES || l.edges.length > DEFAULT_MAX_EDGES) {
    throw new LayoutError("too_large", "Layout exceeds maximum size limits");
  }
  if (l.nodes.length === 0 || l.edges.length === 0) {
    return 0;
  }

  const nodeById = new Map<string, LayoutNode>();
  let maxLayer = 0;
  for (const n of l.nodes) {
    if (
      typeof n.id !== "string" ||
      !Number.isInteger(n.layer) ||
      n.layer < 0 ||
      !Number.isFinite(n.order) ||
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y)
    ) {
      throw new LayoutError("invalid_option", "Malformed node in layout");
    }
    if (nodeById.has(n.id)) {
      throw new LayoutError("duplicate_node", `Duplicate node id: ${safeIdPreview(n.id)}`);
    }
    nodeById.set(n.id, n);
    if (n.layer > maxLayer) {
      maxLayer = n.layer;
    }
  }

  // Detect primary axis for dummy ordering when order of dummy isn't explicitly stored.
  // Detect whether layout is LR or TB by checking if layers advance along X or Y.
  // We can also sort dummy vertices within a layer by their secondary coordinate (x in TB, y in LR)
  // and tie-break by dummy creation order.
  let isLR = false;
  if (maxLayer > 0) {
    let layer0Node: LayoutNode | undefined;
    let layerNNode: LayoutNode | undefined;
    for (const n of l.nodes) {
      if (n.layer === 0 && layer0Node === undefined) layer0Node = n;
      if (n.layer > 0 && layerNNode === undefined) layerNNode = n;
    }
    if (layer0Node !== undefined && layerNNode !== undefined) {
      const dx = Math.abs(layerNNode.x - layer0Node.x);
      const dy = Math.abs(layerNNode.y - layer0Node.y);
      // Check if same-layer nodes differ in Y while different-layer nodes differ in X
      let sameLayerDy = 0;
      let sameLayerDx = 0;
      const byLayer = new Map<number, LayoutNode[]>();
      for (const n of l.nodes) {
        const arr = byLayer.get(n.layer);
        if (arr !== undefined) arr.push(n);
        else byLayer.set(n.layer, [n]);
      }
      for (const arr of byLayer.values()) {
        if (arr.length >= 2) {
          const first = arr[0]!;
          const second = arr[1]!;
          sameLayerDx += Math.abs(second.x - first.x);
          sameLayerDy += Math.abs(second.y - first.y);
        }
      }
      if (sameLayerDy > sameLayerDx || (sameLayerDx === 0 && sameLayerDy === 0 && dx > dy)) {
        isLR = true;
      }
    }
  }

  interface LayerItem {
    readonly id: number;
    readonly isDummy: boolean;
    readonly realOrder: number;
    readonly coord: number;
    readonly creationIdx: number;
    orderPos: number;
  }

  const layerItems: LayerItem[][] = Array.from({ length: maxLayer + 1 }, () => []);
  const nodeItemMap = new Map<string, LayerItem>();
  let nextItemId = 0;

  for (const n of l.nodes) {
    const item: LayerItem = {
      id: nextItemId++,
      isDummy: false,
      realOrder: n.order,
      coord: isLR ? n.y : n.x,
      creationIdx: nextItemId,
      orderPos: n.order,
    };
    layerItems[n.layer]!.push(item);
    nodeItemMap.set(n.id, item);
  }

  // Segments between layer i and layer i + 1
  const segmentsByLayer: Array<Array<{ u: LayerItem; v: LayerItem }>> = Array.from(
    { length: maxLayer },
    () => [],
  );

  let dummyCount = 0;
  for (const e of l.edges) {
    const srcNode = nodeById.get(e.from);
    const dstNode = nodeById.get(e.to);
    if (srcNode === undefined || dstNode === undefined) {
      throw new LayoutError("unknown_node", "Edge references unknown node");
    }
    const pts = e.reversed ? [...e.points].reverse() : e.points;
    const upperNode = e.reversed ? dstNode : srcNode;
    const lowerNode = e.reversed ? srcNode : dstNode;
    const span = lowerNode.layer - upperNode.layer;
    if (span <= 0) {
      continue;
    }
    if (span === 1) {
      const uItem = nodeItemMap.get(upperNode.id)!;
      const vItem = nodeItemMap.get(lowerNode.id)!;
      segmentsByLayer[upperNode.layer]!.push({ u: uItem, v: vItem });
    } else {
      dummyCount += span - 1;
      if (dummyCount > MAX_DUMMY_NODES) {
        throw new LayoutError("too_large", "Too many dummy nodes");
      }
      let prevItem = nodeItemMap.get(upperNode.id)!;
      for (let step = 1; step < span; step++) {
        const dummyLayer = upperNode.layer + step;
        const pt = pts[step] ?? { x: upperNode.x, y: upperNode.y };
        const dItem: LayerItem = {
          id: nextItemId++,
          isDummy: true,
          realOrder: Number.POSITIVE_INFINITY,
          coord: isLR ? pt.y : pt.x,
          creationIdx: nextItemId,
          orderPos: 0,
        };
        layerItems[dummyLayer]!.push(dItem);
        segmentsByLayer[dummyLayer - 1]!.push({ u: prevItem, v: dItem });
        prevItem = dItem;
      }
      const lastItem = nodeItemMap.get(lowerNode.id)!;
      segmentsByLayer[lowerNode.layer - 1]!.push({ u: prevItem, v: lastItem });
    }
  }

  // Establish orderPos within each layer
  for (let i = 0; i <= maxLayer; i++) {
    const items = layerItems[i]!;
    const hasDummies = items.some((it) => it.isDummy);
    if (!hasDummies) {
      items.sort((a, b) => a.realOrder - b.realOrder);
    } else {
      items.sort((a, b) => {
        if (a.coord !== b.coord) return a.coord - b.coord;
        if (!a.isDummy && !b.isDummy) return a.realOrder - b.realOrder;
        return a.creationIdx - b.creationIdx;
      });
    }
    for (let pos = 0; pos < items.length; pos++) {
      items[pos]!.orderPos = pos;
    }
  }

  let totalCrossings = 0;
  for (let i = 0; i < maxLayer; i++) {
    const segs = segmentsByLayer[i]!;
    const m = segs.length;
    for (let a = 0; a < m; a++) {
      const s1 = segs[a]!;
      const u1 = s1.u.orderPos;
      const v1 = s1.v.orderPos;
      for (let b = a + 1; b < m; b++) {
        const s2 = segs[b]!;
        const u2 = s2.u.orderPos;
        const v2 = s2.v.orderPos;
        if ((u1 < u2 && v1 > v2) || (u1 > u2 && v1 < v2)) {
          totalCrossings++;
        }
      }
    }
  }

  return totalCrossings;
}

/**
 * Counts crossings between two adjacent layers given their ordered vertex arrays
 * and the list of directed segments between the upper layer and lower layer.
 */
function countLayerPairCrossings(
  upperLayer: readonly number[],
  lowerLayer: readonly number[],
  posInLayer: Int32Array,
  downNeighborsOf: readonly (readonly number[])[],
): number {
  for (let i = 0; i < upperLayer.length; i++) {
    posInLayer[upperLayer[i]!] = i;
  }
  for (let i = 0; i < lowerLayer.length; i++) {
    posInLayer[lowerLayer[i]!] = i;
  }

  let crossings = 0;
  for (let i = 0; i < upperLayer.length; i++) {
    const u1 = upperLayer[i]!;
    const n1 = downNeighborsOf[u1]!;
    for (let j = 0; j < n1.length; j++) {
      const v1Pos = posInLayer[n1[j]!]!;
      for (let i2 = i + 1; i2 < upperLayer.length; i2++) {
        const u2 = upperLayer[i2]!;
        const n2 = downNeighborsOf[u2]!;
        for (let j2 = 0; j2 < n2.length; j2++) {
          if (v1Pos > posInLayer[n2[j2]!]!) {
            crossings++;
          }
        }
      }
    }
  }
  return crossings;
}

function countAllCrossingsInternal(
  layers: readonly (readonly number[])[],
  posInLayer: Int32Array,
  downNeighborsOf: readonly (readonly number[])[],
): number {
  let total = 0;
  for (let i = 0; i < layers.length - 1; i++) {
    total += countLayerPairCrossings(layers[i]!, layers[i + 1]!, posInLayer, downNeighborsOf);
  }
  return total;
}

// Unused helper removed

/**
 * Computes a deterministic Sugiyama layered graph layout.
 *
 * @param graph - Input graph with nodes and directed edges.
 * @param opts - Optional layout configuration.
 * @returns Computed {@link Layout} with node centres, routed edges and bounding dimensions.
 * @throws {LayoutError} On validation failure or size limit violation.
 */
export function layout(graph: InputGraph, opts?: LayoutOptions): Layout {
  const options = validateOptions(opts);

  if (
    typeof graph !== "object" ||
    graph === null ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  ) {
    throw new LayoutError("invalid_option", "Graph must contain nodes and edges arrays");
  }

  const numNodes = graph.nodes.length;
  const numEdges = graph.edges.length;

  if (numNodes > options.maxNodes) {
    throw new LayoutError(
      "too_large",
      `Graph has ${numNodes} nodes, exceeding maxNodes (${options.maxNodes})`,
    );
  }
  if (numEdges > options.maxEdges) {
    throw new LayoutError(
      "too_large",
      `Graph has ${numEdges} edges, exceeding maxEdges (${options.maxEdges})`,
    );
  }

  const nodeIndexById = new Map<string, number>();
  for (let i = 0; i < numNodes; i++) {
    const n = graph.nodes[i]!;
    if (typeof n !== "object" || n === null || typeof n.id !== "string" || n.id.length === 0) {
      throw new LayoutError("invalid_size", "Node id must be a non-empty string");
    }
    if (nodeIndexById.has(n.id)) {
      throw new LayoutError("duplicate_node", `Duplicate node id: ${safeIdPreview(n.id)}`);
    }
    if (
      typeof n.width !== "number" ||
      !Number.isFinite(n.width) ||
      n.width < 0 ||
      typeof n.height !== "number" ||
      !Number.isFinite(n.height) ||
      n.height < 0
    ) {
      throw new LayoutError("invalid_size", `Invalid dimensions for node ${safeIdPreview(n.id)}`);
    }
    nodeIndexById.set(n.id, i);
  }

  const edgeEndpoints: Array<{ u: number; v: number }> = [];
  const outEdgesByNode: number[][] = Array.from({ length: numNodes }, () => []);

  for (let eIdx = 0; eIdx < numEdges; eIdx++) {
    const e = graph.edges[eIdx]!;
    if (
      typeof e !== "object" ||
      e === null ||
      typeof e.from !== "string" ||
      typeof e.to !== "string"
    ) {
      throw new LayoutError("unknown_node", "Edge endpoints must be strings");
    }
    const u = nodeIndexById.get(e.from);
    if (u === undefined) {
      throw new LayoutError("unknown_node", `Unknown source node: ${safeIdPreview(e.from)}`);
    }
    const v = nodeIndexById.get(e.to);
    if (v === undefined) {
      throw new LayoutError("unknown_node", `Unknown target node: ${safeIdPreview(e.to)}`);
    }
    if (u === v) {
      throw new LayoutError("self_loop", `Self-loop on node: ${safeIdPreview(e.from)}`);
    }
    edgeEndpoints.push({ u, v });
    outEdgesByNode[u]!.push(eIdx);
  }

  if (numNodes === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  // ============================================================================
  // Phase 1: Cycle removal (iterative DFS over nodes in input order,
  // successors in edge input order; an edge to a node on the DFS stack is reversed)
  // ============================================================================
  const state = new Uint8Array(numNodes); // 0 = unvisited, 1 = on stack, 2 = done
  const reversedEdge = new Uint8Array(numEdges);
  const nextEdgeCursor = new Int32Array(numNodes);
  const dfsStack: number[] = [];

  for (let startNode = 0; startNode < numNodes; startNode++) {
    if (state[startNode] !== 0) {
      continue;
    }
    state[startNode] = 1;
    dfsStack.push(startNode);

    while (dfsStack.length > 0) {
      const curr = dfsStack[dfsStack.length - 1]!;
      const outEdges = outEdgesByNode[curr]!;
      const cursor = nextEdgeCursor[curr]!;
      if (cursor < outEdges.length) {
        nextEdgeCursor[curr] = cursor + 1;
        const eIdx = outEdges[cursor]!;
        const target = edgeEndpoints[eIdx]!.v;
        const targetState = state[target]!;
        if (targetState === 1) {
          reversedEdge[eIdx] = 1;
        } else if (targetState === 0) {
          state[target] = 1;
          dfsStack.push(target);
        }
      } else {
        state[curr] = 2;
        dfsStack.pop();
      }
    }
  }

  // ============================================================================
  // Phase 2: Layering (longest path from sources: layer 0 for nodes with no
  // incoming edge, else 1 + max predecessor layer)
  // ============================================================================
  const dagOut: number[][] = Array.from({ length: numNodes }, () => []);
  const inDegree = new Int32Array(numNodes);
  for (let eIdx = 0; eIdx < numEdges; eIdx++) {
    const ep = edgeEndpoints[eIdx]!;
    const u = reversedEdge[eIdx] === 1 ? ep.v : ep.u;
    const v = reversedEdge[eIdx] === 1 ? ep.u : ep.v;
    dagOut[u]!.push(v);
    inDegree[v]! += 1;
  }

  const nodeLayer = new Int32Array(numNodes);
  const queue: number[] = [];
  for (let i = 0; i < numNodes; i++) {
    if (inDegree[i] === 0) {
      queue.push(i);
    }
  }

  let qHead = 0;
  let maxLayer = 0;
  while (qHead < queue.length) {
    const u = queue[qHead++]!;
    const uLayer = nodeLayer[u]!;
    if (uLayer > maxLayer) {
      maxLayer = uLayer;
    }
    const succs = dagOut[u]!;
    for (let i = 0; i < succs.length; i++) {
      const v = succs[i]!;
      if (uLayer + 1 > nodeLayer[v]!) {
        nodeLayer[v] = uLayer + 1;
      }
      inDegree[v]! -= 1;
      if (inDegree[v] === 0) {
        queue.push(v);
      }
    }
  }

  const numLayers = maxLayer + 1;

  // ============================================================================
  // Phase 3: Normalisation (an edge spanning k > 1 layers gets k - 1 dummy
  // nodes of width 0 and height 0)
  // ============================================================================
  const isLR = options.direction === "LR";
  const vertices: InternalVertex[] = [];
  const layers: number[][] = Array.from({ length: numLayers }, () => []);

  // Fast pre-check: calculate total dummy nodes before allocating objects
  let projectedDummies = 0;
  for (let eIdx = 0; eIdx < numEdges; eIdx++) {
    const ep = edgeEndpoints[eIdx]!;
    const rev = reversedEdge[eIdx] === 1;
    const dagU = rev ? ep.v : ep.u;
    const dagV = rev ? ep.u : ep.v;
    const span = nodeLayer[dagV]! - nodeLayer[dagU]!;
    if (span > 1) {
      projectedDummies += span - 1;
      if (projectedDummies > MAX_DUMMY_NODES) {
        throw new LayoutError(
          "too_large",
          `Total dummy nodes exceed maximum limit (${MAX_DUMMY_NODES})`,
        );
      }
    }
  }

  // First add real nodes in input order
  for (let i = 0; i < numNodes; i++) {
    const n = graph.nodes[i]!;
    const layer = nodeLayer[i]!;
    const vIndex = vertices.length;
    vertices.push({
      vIndex,
      isDummy: false,
      inputNodeIndex: i,
      layer,
      spanW: isLR ? n.height : n.width,
      bandH: isLR ? n.width : n.height,
      downNeighbors: [],
      upNeighbors: [],
    });
    layers[layer]!.push(vIndex);
  }

  const edgeChains: EdgeChain[] = [];
  let totalDummyNodes = 0;

  // Process edges in input order
  for (let eIdx = 0; eIdx < numEdges; eIdx++) {
    const ep = edgeEndpoints[eIdx]!;
    const rev = reversedEdge[eIdx] === 1;
    const dagU = rev ? ep.v : ep.u;
    const dagV = rev ? ep.u : ep.v;
    const uLayer = nodeLayer[dagU]!;
    const vLayer = nodeLayer[dagV]!;
    const span = vLayer - uLayer;

    if (span > 1) {
      totalDummyNodes += span - 1;
      if (totalDummyNodes > MAX_DUMMY_NODES) {
        throw new LayoutError(
          "too_large",
          `Total dummy nodes exceed maximum limit (${MAX_DUMMY_NODES})`,
        );
      }
    }

    const chainVertices: number[] = [dagU];
    let prevVIndex = dagU;
    for (let l = uLayer + 1; l < vLayer; l++) {
      const dummyVIndex = vertices.length;
      vertices.push({
        vIndex: dummyVIndex,
        isDummy: true,
        inputNodeIndex: -1,
        layer: l,
        spanW: 0,
        bandH: 0,
        downNeighbors: [],
        upNeighbors: [],
      });
      layers[l]!.push(dummyVIndex);
      vertices[prevVIndex]!.downNeighbors.push(dummyVIndex);
      vertices[dummyVIndex]!.upNeighbors.push(prevVIndex);
      chainVertices.push(dummyVIndex);
      prevVIndex = dummyVIndex;
    }
    vertices[prevVIndex]!.downNeighbors.push(dagV);
    vertices[dagV]!.upNeighbors.push(prevVIndex);
    chainVertices.push(dagV);

    edgeChains.push({
      edgeIndex: eIdx,
      reversed: rev,
      dagU,
      dagV,
      chainVertices,
    });
  }

  const totalVertices = vertices.length;
  const downNeighborsOf: number[][] = vertices.map((v) => v.downNeighbors);
  const upNeighborsOf: number[][] = vertices.map((v) => v.upNeighbors);
  const posInLayer = new Int32Array(totalVertices);

  // Initialize posInLayer
  for (let l = 0; l < numLayers; l++) {
    const layerArr = layers[l]!;
    for (let idx = 0; idx < layerArr.length; idx++) {
      posInLayer[layerArr[idx]!] = idx;
    }
  }

  // ============================================================================
  // Phase 4: Ordering
  // Initial order per layer is node input order, then dummies in edge input order.
  // `sweeps` iterations alternating down and up passes with barycenter
  // (mean of neighbour positions in the fixed layer; nodes without neighbours
  // keep their position; ties keep current order) followed by adjacent-swap
  // transpose while it reduces crossings; keep the best ordering seen
  // (fewest total crossings, earliest wins ties).
  // ============================================================================
  let bestLayers: number[][] = layers.map((arr) => [...arr]);
  let bestCrossings = countAllCrossingsInternal(layers, posInLayer, downNeighborsOf);

  const barycenters = new Float64Array(totalVertices);
  const currentRank = new Int32Array(totalVertices);

  const sortLayerByBarycenter = (
    layerIdx: number,
    neighborsOf: readonly (readonly number[])[],
  ): void => {
    const layerArr = layers[layerIdx]!;
    const len = layerArr.length;
    if (len <= 1) {
      return;
    }
    for (let i = 0; i < len; i++) {
      const v = layerArr[i]!;
      currentRank[v] = i;
      const nbrs = neighborsOf[v]!;
      if (nbrs.length === 0) {
        barycenters[v] = i;
      } else {
        let sum = 0;
        for (let j = 0; j < nbrs.length; j++) {
          sum += posInLayer[nbrs[j]!]!;
        }
        barycenters[v] = sum / nbrs.length;
      }
    }
    layerArr.sort((a, b) => {
      const diff = barycenters[a]! - barycenters[b]!;
      if (diff !== 0) {
        return diff;
      }
      return currentRank[a]! - currentRank[b]!;
    });
    for (let i = 0; i < len; i++) {
      posInLayer[layerArr[i]!] = i;
    }
  };

  const transposeLayers = (downward: boolean): void => {
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 20) {
      improved = false;
      iterations++;
      if (downward) {
        for (let l = 1; l < numLayers; l++) {
          const layerArr = layers[l]!;
          const len = layerArr.length;
          for (let i = 0; i < len - 1; i++) {
            const v = layerArr[i]!;
            const w = layerArr[i + 1]!;
            let cBefore = 0;
            const vUp = upNeighborsOf[v]!;
            const wUp = upNeighborsOf[w]!;
            for (let jv = 0; jv < vUp.length; jv++) {
              const pv = posInLayer[vUp[jv]!]!;
              for (let jw = 0; jw < wUp.length; jw++) {
                if (pv > posInLayer[wUp[jw]!]!) cBefore++;
              }
            }
            let cAfter = 0;
            for (let jw = 0; jw < wUp.length; jw++) {
              const pw = posInLayer[wUp[jw]!]!;
              for (let jv = 0; jv < vUp.length; jv++) {
                if (pw > posInLayer[vUp[jv]!]!) cAfter++;
              }
            }
            if (cAfter < cBefore) {
              layerArr[i] = w;
              layerArr[i + 1] = v;
              posInLayer[w] = i;
              posInLayer[v] = i + 1;
              improved = true;
            }
          }
        }
      } else {
        for (let l = numLayers - 2; l >= 0; l--) {
          const layerArr = layers[l]!;
          const len = layerArr.length;
          for (let i = 0; i < len - 1; i++) {
            const v = layerArr[i]!;
            const w = layerArr[i + 1]!;
            let cBefore = 0;
            const vDown = downNeighborsOf[v]!;
            const wDown = downNeighborsOf[w]!;
            for (let jv = 0; jv < vDown.length; jv++) {
              const pv = posInLayer[vDown[jv]!]!;
              for (let jw = 0; jw < wDown.length; jw++) {
                if (pv > posInLayer[wDown[jw]!]!) cBefore++;
              }
            }
            let cAfter = 0;
            for (let jw = 0; jw < wDown.length; jw++) {
              const pw = posInLayer[wDown[jw]!]!;
              for (let jv = 0; jv < vDown.length; jv++) {
                if (pw > posInLayer[vDown[jv]!]!) cAfter++;
              }
            }
            if (cAfter < cBefore) {
              layerArr[i] = w;
              layerArr[i + 1] = v;
              posInLayer[w] = i;
              posInLayer[v] = i + 1;
              improved = true;
            }
          }
        }
      }
    }
  };

  for (let sweep = 0; sweep < options.sweeps; sweep++) {
    if (bestCrossings === 0) {
      break;
    }
    const isDown = sweep % 2 === 0;
    if (isDown) {
      for (let l = 1; l < numLayers; l++) {
        sortLayerByBarycenter(l, upNeighborsOf);
      }
      transposeLayers(true);
    } else {
      for (let l = numLayers - 2; l >= 0; l--) {
        sortLayerByBarycenter(l, downNeighborsOf);
      }
      transposeLayers(false);
    }

    // posInLayer was maintained by sortLayerByBarycenter and transposeLayers!
    let c = 0;
    for (let l = 0; l < numLayers - 1; l++) {
      const upperLayer = layers[l]!;
      for (let i = 0; i < upperLayer.length; i++) {
        const u1 = upperLayer[i]!;
        const n1 = downNeighborsOf[u1]!;
        for (let j = 0; j < n1.length; j++) {
          const v1Pos = posInLayer[n1[j]!]!;
          for (let i2 = i + 1; i2 < upperLayer.length; i2++) {
            const u2 = upperLayer[i2]!;
            const n2 = downNeighborsOf[u2]!;
            for (let j2 = 0; j2 < n2.length; j2++) {
              if (v1Pos > posInLayer[n2[j2]!]!) {
                c++;
              }
            }
          }
        }
      }
    }

    if (c < bestCrossings) {
      bestCrossings = c;
      bestLayers = layers.map((arr) => [...arr]);
    }
  }

  // Restore bestLayers
  for (let l = 0; l < numLayers; l++) {
    layers[l] = bestLayers[l]!;
    const layerArr = layers[l]!;
    for (let i = 0; i < layerArr.length; i++) {
      posInLayer[layerArr[i]!] = i;
    }
  }

  // ============================================================================
  // Phase 5: Coordinates
  // Within a layer pack left to right with nodeSep gaps; then 4 rounds
  // alternating down and up: target centre = lower median of neighbour centres
  // in the previous (down) or next (up) layer, then place nodes in order at
  // max(target, previous right edge + nodeSep + width / 2); finally translate
  // so the minimum left edge is 0.
  // ============================================================================
  const secCoord = new Float64Array(totalVertices); // x in TB, y in LR
  const priCoord = new Float64Array(totalVertices); // y in TB, x in LR

  // Initial packing within each layer left to right with nodeSep gaps
  for (let l = 0; l < numLayers; l++) {
    const layerArr = layers[l]!;
    let cursor = 0;
    for (let i = 0; i < layerArr.length; i++) {
      const v = layerArr[i]!;
      const w = vertices[v]!.spanW;
      if (i === 0) {
        secCoord[v] = w / 2;
        cursor = w;
      } else {
        const center = cursor + options.nodeSep + w / 2;
        secCoord[v] = center;
        cursor = center + w / 2;
      }
    }
  }

  // 4 rounds alternating down and up
  for (let round = 0; round < 4; round++) {
    const isDown = round % 2 === 0;
    if (isDown) {
      for (let l = 1; l < numLayers; l++) {
        const layerArr = layers[l]!;
        let prevRight = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < layerArr.length; i++) {
          const v = layerArr[i]!;
          const w = vertices[v]!.spanW;
          const nbrs = upNeighborsOf[v]!;
          let target = secCoord[v]!;
          if (nbrs.length > 0) {
            const coords: number[] = [];
            for (let j = 0; j < nbrs.length; j++) {
              coords.push(secCoord[nbrs[j]!]!);
            }
            coords.sort((a, b) => a - b);
            const midIdx = Math.floor((coords.length - 1) / 2);
            target = coords[midIdx]!;
          }
          const minAllowed =
            i === 0 ? Number.NEGATIVE_INFINITY : prevRight + options.nodeSep + w / 2;
          const placed = Math.max(target, minAllowed);
          secCoord[v] = placed;
          prevRight = placed + w / 2;
        }
      }
    } else {
      for (let l = numLayers - 2; l >= 0; l--) {
        const layerArr = layers[l]!;
        let prevRight = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < layerArr.length; i++) {
          const v = layerArr[i]!;
          const w = vertices[v]!.spanW;
          const nbrs = downNeighborsOf[v]!;
          let target = secCoord[v]!;
          if (nbrs.length > 0) {
            const coords: number[] = [];
            for (let j = 0; j < nbrs.length; j++) {
              coords.push(secCoord[nbrs[j]!]!);
            }
            coords.sort((a, b) => a - b);
            const midIdx = Math.floor((coords.length - 1) / 2);
            target = coords[midIdx]!;
          }
          const minAllowed =
            i === 0 ? Number.NEGATIVE_INFINITY : prevRight + options.nodeSep + w / 2;
          const placed = Math.max(target, minAllowed);
          secCoord[v] = placed;
          prevRight = placed + w / 2;
        }
      }
    }
  }

  // Translate so the minimum left edge is 0
  let minLeft = Number.POSITIVE_INFINITY;
  for (let v = 0; v < totalVertices; v++) {
    const left = secCoord[v]! - vertices[v]!.spanW / 2;
    if (left < minLeft) {
      minLeft = left;
    }
  }
  if (!Number.isFinite(minLeft)) {
    minLeft = 0;
  }

  let maxRight = 0;
  for (let v = 0; v < totalVertices; v++) {
    secCoord[v] = secCoord[v]! - minLeft;
    const right = secCoord[v]! + vertices[v]!.spanW / 2;
    if (right > maxRight) {
      maxRight = right;
    }
  }

  // Primary axis coordinates (y in TB, x in LR)
  // Layer i band starts at sum of previous band heights plus i * rankSep;
  // band height = tallest node in the layer; node centred in its band.
  const bandStarts = new Float64Array(numLayers);
  const bandHeights = new Float64Array(numLayers);
  let cumulativeBand = 0;
  for (let l = 0; l < numLayers; l++) {
    const layerArr = layers[l]!;
    let maxH = 0;
    for (let i = 0; i < layerArr.length; i++) {
      const h = vertices[layerArr[i]!]!.bandH;
      if (h > maxH) {
        maxH = h;
      }
    }
    const start = cumulativeBand + l * options.rankSep;
    bandStarts[l] = start;
    bandHeights[l] = maxH;
    cumulativeBand += maxH;
    const bandCenter = start + maxH / 2;
    for (let i = 0; i < layerArr.length; i++) {
      priCoord[layerArr[i]!] = bandCenter;
    }
  }

  const totalPrimary =
    numLayers === 0 ? 0 : bandStarts[numLayers - 1]! + bandHeights[numLayers - 1]!;

  // Real node order within each layer (0-indexed among real nodes in that layer)
  const realNodeOrder = new Int32Array(numNodes);
  for (let l = 0; l < numLayers; l++) {
    const layerArr = layers[l]!;
    let realOrd = 0;
    for (let i = 0; i < layerArr.length; i++) {
      const v = layerArr[i]!;
      const vert = vertices[v]!;
      if (!vert.isDummy) {
        realNodeOrder[vert.inputNodeIndex] = realOrd++;
      }
    }
  }

  const outNodes: LayoutNode[] = [];
  for (let i = 0; i < numNodes; i++) {
    const inNode = graph.nodes[i]!;
    const x = isLR ? priCoord[i]! : secCoord[i]!;
    const y = isLR ? secCoord[i]! : priCoord[i]!;
    const baseNode: LayoutNode = {
      id: inNode.id,
      x,
      y,
      width: inNode.width,
      height: inNode.height,
      layer: nodeLayer[i]!,
      order: realNodeOrder[i]!,
      ...(inNode.label !== undefined ? { label: inNode.label } : {}),
    };
    outNodes.push(baseNode);
  }

  // Edge points: source bottom centre (right centre in LR), each dummy centre,
  // target top centre (left centre in LR). Reversed edges listed in original direction.
  const outEdges: LayoutEdge[] = [];
  for (let eIdx = 0; eIdx < numEdges; eIdx++) {
    const inEdge = graph.edges[eIdx]!;
    const chain = edgeChains[eIdx]!;
    const uNode = outNodes[chain.dagU]!;
    const vNode = outNodes[chain.dagV]!;

    const startPt: Point = isLR
      ? { x: uNode.x + uNode.width / 2, y: uNode.y }
      : { x: uNode.x, y: uNode.y + uNode.height / 2 };

    const endPt: Point = isLR
      ? { x: vNode.x - vNode.width / 2, y: vNode.y }
      : { x: vNode.x, y: vNode.y - vNode.height / 2 };

    const pts: Point[] = [startPt];
    for (let k = 1; k < chain.chainVertices.length - 1; k++) {
      const dV = chain.chainVertices[k]!;
      pts.push({
        x: isLR ? priCoord[dV]! : secCoord[dV]!,
        y: isLR ? secCoord[dV]! : priCoord[dV]!,
      });
    }
    pts.push(endPt);

    if (chain.reversed) {
      pts.reverse();
    }

    outEdges.push({
      from: inEdge.from,
      to: inEdge.to,
      points: pts,
      reversed: chain.reversed,
    });
  }

  const width = isLR ? totalPrimary : maxRight;
  const height = isLR ? maxRight : totalPrimary;

  return {
    nodes: outNodes,
    edges: outEdges,
    width,
    height,
  };
}

function formatSvgNumber(n: number): string {
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  if (Object.is(rounded, -0) || rounded === 0) {
    return "0";
  }
  return Number(rounded.toFixed(2)).toString();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a computed {@link Layout} to a standalone SVG string.
 *
 * @param l - Computed layout object.
 * @param labels - Optional map of node id to custom label.
 * @returns SVG markup string.
 * @throws {LayoutError} When the layout exceeds size limits or is malformed.
 */
export function toSvg(l: Layout): string {
  if (typeof l !== "object" || l === null || !Array.isArray(l.nodes) || !Array.isArray(l.edges)) {
    throw new LayoutError("invalid_option", "Invalid layout object");
  }
  if (l.nodes.length > DEFAULT_MAX_NODES || l.edges.length > DEFAULT_MAX_EDGES) {
    throw new LayoutError("too_large", "Layout exceeds maximum size limits");
  }

  const wStr = formatSvgNumber(l.width);
  const hStr = formatSvgNumber(l.height);

  const edgeStrings: string[] = [];
  for (let i = 0; i < l.edges.length; i++) {
    const e = l.edges[i]!;
    if (e.points.length === 0) {
      continue;
    }
    const parts: string[] = [];
    for (let j = 0; j < e.points.length; j++) {
      const pt = e.points[j]!;
      const cmd = j === 0 ? "M" : "L";
      parts.push(`${cmd} ${formatSvgNumber(pt.x)} ${formatSvgNumber(pt.y)}`);
    }
    edgeStrings.push(`<path d="${parts.join(" ")}" fill="none" stroke="#000000"/>`);
  }

  const nodeStrings: string[] = [];
  for (let i = 0; i < l.nodes.length; i++) {
    const n = l.nodes[i]!;
    const rx = formatSvgNumber(n.x - n.width / 2);
    const ry = formatSvgNumber(n.y - n.height / 2);
    const rw = formatSvgNumber(n.width);
    const rh = formatSvgNumber(n.height);
    const tx = formatSvgNumber(n.x);
    const ty = formatSvgNumber(n.y);
    const textContent = escapeXml(n.label ?? n.id);
    nodeStrings.push(
      `<g id="node-${i}"><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#ffffff" stroke="#000000"/><text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central">${textContent}</text></g>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wStr}" height="${hStr}" viewBox="0 0 ${wStr} ${hStr}"><g class="edges">${edgeStrings.join("")}</g><g class="nodes">${nodeStrings.join("")}</g></svg>`;
}
