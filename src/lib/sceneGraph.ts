import { STENCIL_PRESETS } from '../data/methodology';
import type {
  ArchEdge,
  ArchNode,
  ChallengeSpec,
  ComponentKind,
  RubricAxisScore,
  StageId,
  TopologyFinding,
  TopologyGraph,
} from '../types';

export interface RawExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  text?: string;
  containerId?: string | null;
  boundElements?: ReadonlyArray<{ id: string; type: string }> | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: { kind?: ComponentKind; role?: string } | null;
}

const ROLE_PATTERNS: Array<{ kind: ComponentKind; regex: RegExp }> = [
  { kind: 'client', regex: /\b(client|browser|mobile|ios|android|web\s*app|user|rider|driver|sdk)\b/i },
  { kind: 'cdn', regex: /\b(cdn|cloudflare|cloudfront|fastly|edge\s*cache|pop)\b/i },
  {
    kind: 'gateway',
    regex: /\b(gateway|load\s*balancer|alb|nlb|nginx|envoy|ingress|ws\s*gateway|websocket|proxy|rate\s*limit)\b/i,
  },
  { kind: 'cache', regex: /\b(redis|memcached|cache|in-memory|geohash|quadtree|h3|sorted\s*set|lock)\b/i },
  { kind: 'queue', regex: /\b(kafka|queue|sqs|sns|pubsub|rabbit|kinesis|stream|log|bus|frontier)\b/i },
  { kind: 'blob', regex: /\b(s3|blob|object\s*store|gcs|r2|chunk|media\s*store|parquet)\b/i },
  {
    kind: 'database',
    regex: /\b(db|database|postgres|mysql|sql|dynamodb|cassandra|mongo|spanner|cockroach|clickhouse|olap|ledger)\b/i,
  },
  { kind: 'search', regex: /\b(elastic|opensearch|inverted\s*index|search\s*index|meilisearch)\b/i },
  { kind: 'worker', regex: /\b(worker|consumer|flink|spark|sandbox|microvm|judge|aggregator|fan-?out)\b/i },
  { kind: 'service', regex: /\b(service|server|api|controller|engine|collector|dispatcher|matcher)\b/i },
];

export function classifyComponentKind(label: string, explicitKind?: ComponentKind): ComponentKind {
  if (explicitKind) return explicitKind;
  const trimmed = label.trim();
  for (const rule of ROLE_PATTERNS) {
    if (rule.regex.test(trimmed)) {
      return rule.kind;
    }
  }
  return 'service';
}

function pointNearShape(px: number, py: number, node: ArchNode, margin = 44): boolean {
  return (
    px >= node.x - margin &&
    px <= node.x + node.width + margin &&
    py >= node.y - margin &&
    py <= node.y + node.height + margin
  );
}

function nearestNodeToPoint(px: number, py: number, nodes: ArchNode[], maxDist = 72): ArchNode | null {
  let best: ArchNode | null = null;
  let bestDist = maxDist;
  for (const node of nodes) {
    const cx = Math.max(node.x, Math.min(px, node.x + node.width));
    const cy = Math.max(node.y, Math.min(py, node.y + node.height));
    const dist = Math.hypot(px - cx, py - cy);
    if (dist <= bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}

export function extractTopology(
  rawElements: readonly RawExcalidrawElement[],
  challenge?: ChallengeSpec,
): TopologyGraph {
  const active = rawElements.filter((el) => !el.isDeleted);
  const textByContainer = new Map<string, string[]>();
  const standaloneTexts: RawExcalidrawElement[] = [];

  for (const el of active) {
    if (el.type === 'text' && el.text?.trim()) {
      if (el.containerId) {
        const list = textByContainer.get(el.containerId) ?? [];
        list.push(el.text.trim());
        textByContainer.set(el.containerId, list);
      } else {
        standaloneTexts.push(el);
      }
    }
  }

  const shapeTypes = new Set(['rectangle', 'ellipse', 'diamond']);
  const nodes: ArchNode[] = [];
  const usedStandaloneIds = new Set<string>();

  for (const el of active) {
    if (!shapeTypes.has(el.type)) continue;
    const width = Math.abs(el.width ?? 140);
    const height = Math.abs(el.height ?? 68);
    if (width < 20 && height < 20) continue;

    const x = (el.width ?? 0) < 0 ? el.x + (el.width ?? 0) : el.x;
    const y = (el.height ?? 0) < 0 ? el.y + (el.height ?? 0) : el.y;

    const boundLines = [...(textByContainer.get(el.id) ?? [])];
    for (const t of standaloneTexts) {
      const tx = t.x + (t.width ?? 0) / 2;
      const ty = t.y + (t.height ?? 0) / 2;
      if (tx >= x - 8 && tx <= x + width + 8 && ty >= y - 8 && ty <= y + height + 8) {
        boundLines.push(t.text!.trim());
        usedStandaloneIds.add(t.id);
      }
    }

    const fullText = boundLines.join(' ').replace(/\s+/g, ' ').trim();
    const label = fullText || STENCIL_PRESETS.find((p) => p.kind === el.customData?.kind)?.defaultTitle || 'Unlabeled Node';
    const kind = classifyComponentKind(label, el.customData?.kind);

    // Check nearby schema / math notes just below or beside a store
    const adjacentNotes: string[] = [];
    for (const t of standaloneTexts) {
      if (usedStandaloneIds.has(t.id)) continue;
      const tx = t.x;
      const ty = t.y;
      if (tx >= x - 30 && tx <= x + width + 110 && ty >= y + height - 4 && ty <= y + height + 84) {
        adjacentNotes.push(t.text!.trim());
        usedStandaloneIds.add(t.id);
      }
    }

    nodes.push({
      id: el.id,
      label,
      kind,
      x,
      y,
      width,
      height,
      notes: adjacentNotes.length > 0 ? adjacentNotes.join(' | ') : undefined,
    });
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: ArchEdge[] = [];

  for (const el of active) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    let fromNode = el.startBinding?.elementId ? nodeById.get(el.startBinding.elementId) ?? null : null;
    let toNode = el.endBinding?.elementId ? nodeById.get(el.endBinding.elementId) ?? null : null;

    if ((!fromNode || !toNode) && el.points && el.points.length >= 2) {
      const [sx, sy] = el.points[0];
      const [ex, ey] = el.points[el.points.length - 1];
      if (!fromNode) fromNode = nearestNodeToPoint(el.x + sx, el.y + sy, nodes);
      if (!toNode) toNode = nearestNodeToPoint(el.x + ex, el.y + ey, nodes);
    }

    if (fromNode && toNode && fromNode.id !== toNode.id) {
      const edgeText = (textByContainer.get(el.id) ?? []).join(' ').trim();
      edges.push({
        id: el.id,
        fromId: fromNode.id,
        toId: toNode.id,
        fromLabel: fromNode.label,
        toLabel: toNode.label,
        fromKind: fromNode.kind,
        toKind: toNode.kind,
        label: edgeText,
      });
    }
  }

  const freeNotes: string[] = [];
  for (const t of standaloneTexts) {
    if (!usedStandaloneIds.has(t.id) && t.text?.trim()) {
      const nearAny = nodes.some((n) => pointNearShape(t.x, t.y, n, 12));
      if (!nearAny) {
        freeNotes.push(t.text.trim());
      }
    }
  }

  const connectedIds = new Set<string>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const edge of edges) {
    connectedIds.add(edge.fromId);
    connectedIds.add(edge.toId);
    outDegree.set(edge.fromId, (outDegree.get(edge.fromId) ?? 0) + 1);
    inDegree.set(edge.toId, (inDegree.get(edge.toId) ?? 0) + 1);
  }

  const orphans = nodes.length > 1 ? nodes.filter((n) => !connectedIds.has(n.id)) : [];
  const singlePoints = nodes.filter(
    (n) =>
      n.kind === 'service' &&
      (inDegree.get(n.id) ?? 0) >= 2 &&
      (outDegree.get(n.id) ?? 0) >= 2 &&
      !/cluster|pool|stateless|shard|replica/i.test(n.label),
  );

  const findings = evaluateFindings(nodes, edges, orphans, freeNotes, challenge);

  const fingerprint = [
    nodes.map((n) => `${n.kind}:${n.label}`).sort().join(','),
    edges.map((e) => `${e.fromLabel}->${e.toLabel}:${e.label}`).sort().join(','),
    freeNotes.length,
  ].join('||');

  return {
    nodes,
    edges,
    freeNotes,
    orphans,
    singlePoints,
    findings,
    fingerprint,
  };
}

function evaluateFindings(
  nodes: ArchNode[],
  edges: ArchEdge[],
  orphans: ArchNode[],
  freeNotes: string[],
  challenge?: ChallengeSpec,
): TopologyFinding[] {
  const findings: TopologyFinding[] = [];
  if (nodes.length === 0) return findings;

  const kinds = new Set(nodes.map((n) => n.kind));

  // 1. Direct Client -> Database anti-pattern
  const directClientDb = edges.find((e) => e.fromKind === 'client' && e.toKind === 'database');
  if (directClientDb && (challenge?.forbidDirectClientDb ?? true)) {
    findings.push({
      id: 'direct-client-db',
      severity: 'warn',
      title: 'Client connected directly to Database',
      detail: `${directClientDb.fromLabel} connects straight to ${directClientDb.toLabel}. Place an API Gateway and stateless service layer in front to enforce auth, validation, and connection pooling.`,
      nodeIds: [directClientDb.fromId, directClientDb.toId],
    });
  }

  // 2. Unlabeled nodes
  const unlabeled = nodes.filter((n) => n.label === 'Unlabeled Node');
  if (unlabeled.length > 0) {
    findings.push({
      id: 'unlabeled-nodes',
      severity: 'info',
      title: `${unlabeled.length} unlabeled box${unlabeled.length > 1 ? 'es' : ''} on board`,
      detail: 'Double-click shapes to give them clear domain names so an interviewer reviewing the board later can follow each responsibility.',
      nodeIds: unlabeled.map((u) => u.id),
    });
  }

  // 3. Disconnected orphan components
  if (orphans.length > 0 && nodes.length >= 3) {
    findings.push({
      id: 'orphan-nodes',
      severity: 'info',
      title: `${orphans.length} disconnected component${orphans.length > 1 ? 's' : ''}`,
      detail: `${orphans.map((o) => o.label).slice(0, 3).join(', ')} ha${orphans.length > 1 ? 've' : 's'} no arrows showing read/write flow.`,
      nodeIds: orphans.map((o) => o.id),
    });
  }

  // 4. Blob offload check for file/media systems
  if (challenge?.requiresBlobOffload) {
    const clientToServiceOnly =
      edges.some((e) => e.fromKind === 'client' && (e.toKind === 'service' || e.toKind === 'gateway')) &&
      !kinds.has('blob');
    if (clientToServiceOnly) {
      findings.push({
        id: 'missing-blob-store',
        severity: 'warn',
        title: 'Large payloads lack Object Storage offload',
        detail: 'Avoid streaming multi-GB chunks through stateless API servers or into SQL tables. Issue presigned URLs so clients upload/download directly against Object Storage / CDN.',
      });
    } else if (
      kinds.has('blob') &&
      edges.some(
        (e) =>
          (e.fromKind === 'client' && (e.toKind === 'blob' || e.toKind === 'cdn')) ||
          ((e.fromKind === 'blob' || e.fromKind === 'cdn') && e.toKind === 'client'),
      )
    ) {
      findings.push({
        id: 'presigned-offload-good',
        severity: 'good',
        title: 'Direct Client ↔ Object Store / CDN transfer path',
        detail: 'Clean separation between control-plane metadata APIs and data-plane binary transfer.',
      });
    }
  }

  // 5. Read-heavy latency check
  if (challenge?.requiresReadCache && nodes.length >= 3 && kinds.has('database') && !kinds.has('cache')) {
    findings.push({
      id: 'missing-read-cache',
      severity: 'info',
      title: 'Tight read SLA hits Database without Cache',
      detail: `To sustain ${challenge.slaTargets[0]?.toLowerCase() ?? 'low-latency reads'}, consider an in-memory cache or index alongside your primary store.`,
    });
  }

  // 6. Async decoupling check
  if (challenge?.requiresAsyncQueue && nodes.length >= 3 && !kinds.has('queue')) {
    findings.push({
      id: 'missing-async-queue',
      severity: 'info',
      title: 'Synchronous write path without Queue / Stream',
      detail: 'Heavy fan-out, stream aggregation, or untrusted sandbox execution benefits from a durable queue/log to absorb burst spikes.',
    });
  }

  // 7. Schema / inline math annotations praised
  const annotatedStores = nodes.filter((n) => (n.kind === 'database' || n.kind === 'cache') && n.notes);
  const hasMathNote = [...freeNotes, ...nodes.map((n) => n.notes ?? '')].some((txt) =>
    /\b(\d+\s*(gb|tb|mb|ms|qps|rps|dau|bytes|shards?))\b/i.test(txt),
  );
  if (annotatedStores.length > 0 || hasMathNote) {
    findings.push({
      id: 'inline-annotations-good',
      severity: 'good',
      title: 'Inline schema / capacity notes on canvas',
      detail: 'Annotating key fields or sizing numbers right next to affected stores makes trade-offs self-explanatory.',
    });
  }

  return findings;
}

export function scoreRubric(
  graph: TopologyGraph,
  challenge: ChallengeSpec,
  candidateTurns: number,
  checkedItemCount: number,
  totalChecklistCount: number,
): RubricAxisScore[] {
  const kinds = new Set(graph.nodes.map((n) => n.kind));
  const matchedExpected = challenge.expectedKinds.filter((k) => kinds.has(k)).length;
  const expectedRatio = challenge.expectedKinds.length > 0 ? matchedExpected / challenge.expectedKinds.length : 0;
  const checklistRatio = totalChecklistCount > 0 ? checkedItemCount / totalChecklistCount : 0;

  const hasEndToEnd =
    graph.edges.length >= 2 &&
    (kinds.has('client') || kinds.has('gateway')) &&
    (kinds.has('database') || kinds.has('cache') || kinds.has('blob'));

  const labeledEdges = graph.edges.filter((e) => e.label.length > 0).length;
  const warnCount = graph.findings.filter((f) => f.severity === 'warn').length;
  const goodCount = graph.findings.filter((f) => f.severity === 'good').length;

  const prioritization = Math.min(
    100,
    Math.round(25 + checklistRatio * 45 + Math.min(candidateTurns, 3) * 10),
  );
  const coherence = Math.min(
    100,
    Math.max(
      10,
      Math.round(
        (hasEndToEnd ? 40 : 12) +
          expectedRatio * 45 +
          Math.min(graph.edges.length * 4, 15) -
          warnCount * 12 -
          graph.orphans.length * 6,
      ),
    ),
  );
  const depth = Math.min(
    100,
    Math.round(
      15 +
        (kinds.has('cache') ? 20 : 0) +
        (kinds.has('queue') ? 20 : 0) +
        (kinds.has('worker') || kinds.has('blob') || kinds.has('cdn') ? 15 : 0) +
        goodCount * 15 +
        Math.min(candidateTurns * 5, 15),
    ),
  );
  const clarity = Math.min(
    100,
    Math.round(
      20 +
        (graph.nodes.length > 0 ? 25 : 0) +
        Math.min(labeledEdges * 10, 25) +
        Math.min(candidateTurns * 10, 30) -
        graph.nodes.filter((n) => n.label === 'Unlabeled Node').length * 10,
    ),
  );

  return [
    {
      id: 'prioritization',
      label: 'Scope & Prioritization',
      score: prioritization,
      note:
        prioritization >= 70
          ? 'Focused on core capabilities & SLAs'
          : 'Pin down 3 core goals + measurable SLAs',
    },
    {
      id: 'coherence',
      label: 'End-to-End Topology',
      score: coherence,
      note: hasEndToEnd
        ? `${graph.nodes.length} components, ${graph.edges.length} dataflow edges`
        : 'Connect ingress through services to durable storage',
    },
    {
      id: 'depth',
      label: 'Scale & Failure Depth',
      score: depth,
      note:
        depth >= 70
          ? 'Caching, async buffering & sizing addressed'
          : 'Add caching, queues, or inline sizing math for hot paths',
    },
    {
      id: 'clarity',
      label: 'Board & Verbal Clarity',
      score: clarity,
      note:
        labeledEdges > 0
          ? `${labeledEdges} labeled protocol/payload arrow${labeledEdges > 1 ? 's' : ''}`
          : 'Label arrows (e.g. REST, WS, presigned PUT) & speak trade-offs',
    },
  ];
}

export function serializeTopologyForLlm(graph: TopologyGraph, stage: StageId): string {
  if (graph.nodes.length === 0 && graph.freeNotes.length === 0) {
    return `Stage: ${stage} | Canvas: empty (0 components drawn yet).`;
  }
  const nodeSummary = graph.nodes
    .slice(0, 16)
    .map((n) => `${n.label} [${n.kind}]${n.notes ? ` (${n.notes})` : ''}`)
    .join('; ');
  const edgeSummary =
    graph.edges.length > 0
      ? graph.edges
          .slice(0, 18)
          .map((e) => `${e.fromLabel} -> ${e.toLabel}${e.label ? ` (${e.label})` : ''}`)
          .join('; ')
      : 'none';
  const notesSummary = graph.freeNotes.length > 0 ? ` | Notes: ${graph.freeNotes.slice(0, 5).join(' / ')}` : '';
  const alertSummary =
    graph.findings.length > 0
      ? ` | Diagnostics: ${graph.findings.map((f) => `${f.severity.toUpperCase()}: ${f.title}`).join('; ')}`
      : '';

  return `Stage: ${stage} | Nodes (${graph.nodes.length}): ${nodeSummary} | Edges (${graph.edges.length}): ${edgeSummary}${notesSummary}${alertSummary}`;
}

export function buildStencilSkeleton(
  kind: ComponentKind,
  existingElements: readonly RawExcalidrawElement[],
  isDark: boolean,
  customLabel?: string,
) {
  const preset = STENCIL_PRESETS.find((p) => p.kind === kind) ?? STENCIL_PRESETS[3];
  const active = existingElements.filter((e) => !e.isDeleted && e.type !== 'arrow' && e.type !== 'text');
  const count = active.length;
  const col = count % 3;
  const row = Math.floor(count / 3);
  const baseX = 110 + col * 240;
  const baseY = 120 + row * 145;

  return [
    {
      type: preset.shape,
      x: baseX,
      y: baseY,
      width: 176,
      height: 76,
      strokeColor: isDark ? preset.darkStrokeColor : preset.strokeColor,
      backgroundColor: isDark ? preset.darkBackgroundColor : preset.backgroundColor,
      fillStyle: 'solid' as const,
      strokeWidth: 1.5,
      roughness: 0,
      roundness: preset.shape === 'rectangle' ? { type: 3 } : null,
      customData: { kind },
      label: {
        text: customLabel || preset.defaultTitle,
        fontSize: 16,
        strokeColor: isDark ? '#f3f4f6' : '#18181b',
      },
    },
  ];
}

export function buildArrowSkeletonBetweenNodes(
  fromNode: ArchNode,
  toNode: ArchNode,
  isDark: boolean,
  protocolLabel?: string,
) {
  const startX = fromNode.x + fromNode.width;
  const startY = fromNode.y + fromNode.height / 2;
  const endX = toNode.x;
  const endY = toNode.y + toNode.height / 2;
  const dx = endX - startX;
  const dy = endY - startY;

  return [
    {
      type: 'arrow' as const,
      x: startX,
      y: startY,
      points: [
        [0, 0],
        [dx, dy],
      ] as [number, number][],
      strokeColor: isDark ? '#cbd5e1' : '#334155',
      strokeWidth: 1.5,
      roughness: 0,
      start: { id: fromNode.id },
      end: { id: toNode.id },
      ...(protocolLabel?.trim()
        ? {
            label: {
              text: protocolLabel.trim(),
              fontSize: 13,
            },
          }
        : {}),
    },
  ];
}
