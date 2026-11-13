import {
  createNeedle,
  createWhistle,
  tool,
  type Needle,
  type Whistle,
} from 'cactus-needle/browser';
import { CHALLENGES } from '../data/challenges';
import { INTERVIEW_PLAYBOOK } from '../data/playbook';
import type {
  ChallengeSpec,
  ComponentKind,
  ExtractedDesignSignals,
  NeedleStatus,
  StageId,
  TopologyGraph,
} from '../types';

const SYSTEM_DESIGN_KEYWORDS = [
  'Redis',
  'PostgreSQL',
  'Postgres',
  'DynamoDB',
  'Cassandra',
  'Kafka',
  'Kinesis',
  'RabbitMQ',
  'SQS',
  'Cloudflare',
  'CDN',
  'API Gateway',
  'Load Balancer',
  'Presigned URL',
  'Object Storage',
  'S3',
  'Idempotency',
  'Consistent Hashing',
  'WebSocket',
  'SSE',
  'gRPC',
  'REST',
  'GraphQL',
  'Geohash',
  'QuadTree',
  'Uber H3',
  'Token Bucket',
  'Sliding Window',
  'Outbox',
  'CDC',
  'SimHash',
  'Inverted Index',
  'Scatter-Gather',
  'Firecracker',
  'Sharding',
  'Read Replica',
  'CAP Theorem',
  'SLA',
  'p99',
  'QPS',
  'Lua',
  'TTL',
  'Fencing Token',
  'CAS',
];

export function buildWhistleKeywords(
  challenge?: ChallengeSpec,
  graph?: TopologyGraph,
): string[] {
  const dynamic = new Set<string>(SYSTEM_DESIGN_KEYWORDS);
  if (challenge) {
    for (const ent of challenge.coreEntities) dynamic.add(ent);
  }
  if (graph) {
    for (const node of graph.nodes) {
      if (node.label && node.label !== 'Unlabeled Node') {
        dynamic.add(node.label);
      }
    }
  }
  return Array.from(dynamic).slice(0, 64);
}

export function sanitizePcm16k(pcm: Float32Array): Float32Array {
  const maxSamples = 16000 * 29; // Whistle max batch is 30s (480,000 samples)
  const len = Math.min(pcm.length, maxSamples);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const v = pcm[i];
    out[i] = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  }
  return out;
}

function resolveAppAsset(relPath: string): string {
  const base =
    typeof document !== 'undefined' && document.baseURI
      ? document.baseURI
      : typeof window !== 'undefined'
        ? window.location.href
        : 'http://localhost/';
  const u = new URL(base);
  u.hash = '';
  u.search = '';
  if (!u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/[^/]*$/, '/');
  }
  return new URL(relPath.replace(/^\//, ''), u.toString()).toString();
}

export class CactusWhistleTranscriber {
  private session: Whistle | null = null;
  private loadingPromise: Promise<Whistle> | null = null;

  async ensureLoaded(onProgress?: (pct: number) => void): Promise<Whistle> {
    if (this.session) return this.session;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = createWhistle({
      workerUrl: resolveAppAsset('cactus/worker.js'),
      wasmUrl: resolveAppAsset('cactus/needle.wasm'),
      cache: true,
      onDownloadProgress: ({ percentage }) => {
        if (typeof percentage === 'number') {
          onProgress?.(Math.round(percentage));
        }
      },
    }).then((whistle) => {
      this.session = whistle;
      this.loadingPromise = null;
      onProgress?.(100);
      return whistle;
    }).catch((err) => {
      this.loadingPromise = null;
      throw err;
    });

    return this.loadingPromise;
  }

  async transcribePcm(
    pcm: Float32Array,
    keywords: readonly string[],
  ): Promise<{
    text: string;
    ttftMs: number;
    tokensPerSecond: number;
    language: string;
  }> {
    const whistle = await this.ensureLoaded();
    const cleanPcm = sanitizePcm16k(pcm);
    const res = await whistle.transcribe(cleanPcm, {
      language: 'en',
      keywords,
      wordTimestamps: false,
    });
    return {
      text: res.text.trim(),
      ttftMs: Math.round(res.timeToFirstTokenMs),
      tokensPerSecond: Math.round(res.tokensPerSecond),
      language: res.language,
    };
  }

  async dispose(): Promise<void> {
    if (this.session) {
      const s = this.session;
      this.session = null;
      await s.close();
    }
  }
}

export type CanvasToolAction =
  | { type: 'add_component'; kind: ComponentKind; label?: string }
  | { type: 'connect_components'; fromLabel: string; toLabel: string; protocol?: string }
  | { type: 'set_stage'; stage: StageId }
  | { type: 'select_challenge'; challengeId: string }
  | { type: 'control_timer'; action: 'start' | 'pause' | 'reset' }
  | { type: 'clear_board' };

const STUDIO_TOOLS = {
  add_component: tool({
    description:
      'Add an architecture component box onto the Excalidraw system design whiteboard when the user asks to add, drop, place, or create a component.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'client',
            'cdn',
            'gateway',
            'service',
            'cache',
            'queue',
            'database',
            'blob',
            'worker',
            'search',
          ],
          description: 'Architectural role of the component.',
        },
        label: {
          type: 'string',
          description: 'Display title on the box, such as Redis Cache, Postgres DB, or Kafka Queue.',
        },
      },
      required: ['kind', 'label'],
    } as const,
  }),
  connect_components: tool({
    description:
      'Draw a directed arrow connecting two existing components on the whiteboard when the user asks to connect, wire, link, or route from one box to another.',
    inputSchema: {
      type: 'object',
      properties: {
        fromLabel: {
          type: 'string',
          description: 'Source component name on the canvas.',
        },
        toLabel: {
          type: 'string',
          description: 'Target component name on the canvas.',
        },
        protocol: {
          type: 'string',
          description: 'Optional wire protocol or payload label such as HTTPS, gRPC, WS, or Presigned PUT.',
        },
      },
      required: ['fromLabel', 'toLabel'],
    } as const,
  }),
  set_stage: tool({
    description:
      'Switch the active system design interview stage when the user asks to move to scope, contracts/API, topology/high-level design, or hardening/deep dive.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['scope', 'contracts', 'topology', 'hardening'],
        },
      },
      required: ['stage'],
    } as const,
  }),
  select_challenge: tool({
    description: 'Switch the active system design interview problem when requested.',
    inputSchema: {
      type: 'object',
      properties: {
        challengeId: {
          type: 'string',
          enum: CHALLENGES.map((c) => c.id),
        },
      },
      required: ['challengeId'],
    } as const,
  }),
  control_timer: tool({
    description: 'Start, pause, or reset the 35-minute mock interview countdown timer.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'pause', 'reset'],
        },
      },
      required: ['action'],
    } as const,
  }),
  clear_board: tool({
    description: 'Clear all components from the whiteboard when explicitly asked to clear or wipe the canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean' },
      },
      required: ['confirm'],
    } as const,
  }),
};

const DESIGN_SIGNAL_SCHEMA = {
  type: 'object',
  properties: {
    latencySla: {
      type: 'string',
      description: 'Stated latency target such as < 200ms p99 or 25ms.',
    },
    scaleTarget: {
      type: 'string',
      description: 'Stated scale or throughput target such as 100M DAU or 250k writes/sec.',
    },
    consistencyModel: {
      type: 'string',
      enum: ['CP', 'AP'],
      description: 'CAP priority: CP for strong consistency or AP for high availability.',
    },
    wireProtocol: {
      type: 'string',
      description: 'Primary API protocol mentioned such as REST, WebSocket, SSE, or gRPC.',
    },
    primaryStorage: {
      type: 'string',
      description: 'Primary storage technology mentioned such as Postgres, DynamoDB, Redis, or S3.',
    },
  },
} as const;

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

const ACTION_INTENT_REGEX =
  /\b(add|drop|place|stamp|insert|connect|wire|link|route|switch\s+to|move\s+to|go\s+to|start\s+timer|pause\s+timer|reset\s+timer|clear\s+(the\s+)?(board|canvas))\b/i;

export function looksLikeCanvasCommand(input: string): boolean {
  return ACTION_INTENT_REGEX.test(input.trim());
}

export class CactusNeedleController {
  private needle: Needle<typeof STUDIO_TOOLS> | null = null;
  private loadingPromise: Promise<Needle<typeof STUDIO_TOOLS>> | null = null;
  private playbookEmbeddings: Array<{ id: string; vec: Float32Array }> | null = null;
  private status: NeedleStatus = {
    enabled: false,
    ready: false,
    loading: false,
    progress: 0,
  };
  private listeners = new Set<(status: NeedleStatus) => void>();

  getStatus(): NeedleStatus {
    return this.status;
  }

  subscribe(fn: (status: NeedleStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<NeedleStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) {
      fn({ ...this.status });
    }
  }

  async enable(): Promise<void> {
    if (this.needle) {
      this.update({ enabled: true, ready: true, loading: false, progress: 100 });
      return;
    }
    if (this.loadingPromise) return;

    this.update({ enabled: true, loading: true, progress: 3, error: undefined });

    try {
      this.loadingPromise = createNeedle({
        workerUrl: resolveAppAsset('cactus/worker.js'),
        wasmUrl: resolveAppAsset('cactus/needle.wasm'),
        cache: true,
        stateless: true,
        tools: STUDIO_TOOLS,
        onDownloadProgress: ({ percentage }) => {
          if (typeof percentage === 'number') {
            this.update({ progress: Math.max(3, Math.round(percentage)) });
          }
        },
      });
      this.needle = await this.loadingPromise;
      this.loadingPromise = null;
      this.update({
        enabled: true,
        ready: true,
        loading: false,
        progress: 100,
        error: undefined,
      });
    } catch (err) {
      this.loadingPromise = null;
      this.update({
        enabled: false,
        ready: false,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async indexPlaybookEmbeddings() {
    if (!this.needle || this.playbookEmbeddings) return;
    try {
      const entries: Array<{ id: string; vec: Float32Array }> = [];
      for (const card of INTERVIEW_PLAYBOOK) {
        const text = `${card.title}. ${card.summary} ${card.bullets.join(' ')}`;
        const vec = await this.needle.embed(text);
        entries.push({ id: card.id, vec });
      }
      this.playbookEmbeddings = entries;
    } catch {
      // Non-fatal background indexing
    }
  }

  async analyzeCandidateTurn(
    text: string,
    existingNodes: string[],
  ): Promise<{
    actions: CanvasToolAction[];
    signals: Partial<ExtractedDesignSignals>;
    matchedPlaybookId?: string;
    confidence?: number | null;
  }> {
    const trimmed = text.trim();
    if (!trimmed || !this.needle || !this.status.ready) {
      return { actions: [], signals: extractRegexFallbackSignals(trimmed) };
    }

    const actions: CanvasToolAction[] = [];
    let confidence: number | null = null;

    // 1. Needle 3 Tool Calling for whiteboard/session actions
    if (looksLikeCanvasCommand(trimmed)) {
      try {
        const contextPrompt =
          existingNodes.length > 0
            ? `Existing whiteboard boxes: ${existingNodes.join(', ')}. Request: ${trimmed}`
            : trimmed;
        const gen = await this.needle.generate({ prompt: contextPrompt });
        confidence = gen.confidence;
        for (const call of gen.toolCalls) {
          const args = call.input as Record<string, any>;
          if (call.toolName === 'add_component' && args.kind) {
            actions.push({
              type: 'add_component',
              kind: args.kind as ComponentKind,
              label: typeof args.label === 'string' ? args.label : undefined,
            });
          } else if (call.toolName === 'connect_components' && args.fromLabel && args.toLabel) {
            actions.push({
              type: 'connect_components',
              fromLabel: String(args.fromLabel),
              toLabel: String(args.toLabel),
              protocol: typeof args.protocol === 'string' ? args.protocol : undefined,
            });
          } else if (call.toolName === 'set_stage' && args.stage) {
            actions.push({ type: 'set_stage', stage: args.stage as StageId });
          } else if (call.toolName === 'select_challenge' && args.challengeId) {
            actions.push({ type: 'select_challenge', challengeId: String(args.challengeId) });
          } else if (call.toolName === 'control_timer' && args.action) {
            actions.push({ type: 'control_timer', action: args.action });
          } else if (call.toolName === 'clear_board' && args.confirm) {
            actions.push({ type: 'clear_board' });
          }
        }
      } catch {
        // Ignore tool error and proceed to extraction
      }
    }

    // 2. Needle 3 Grammar-Constrained Design Signal Extraction
    let signals: Partial<ExtractedDesignSignals> = extractRegexFallbackSignals(trimmed);
    if (trimmed.length >= 16 && actions.length === 0) {
      try {
        const extracted = (await this.needle.extract(trimmed, DESIGN_SIGNAL_SCHEMA, {
          strict: false,
          maxNewTokens: 128,
        })) as Record<string, unknown> | null;
        if (extracted) {
          signals = {
            ...signals,
            ...(typeof extracted.latencySla === 'string' && extracted.latencySla.trim()
              ? { latencySla: extracted.latencySla.trim() }
              : {}),
            ...(typeof extracted.scaleTarget === 'string' && extracted.scaleTarget.trim()
              ? { scaleTarget: extracted.scaleTarget.trim() }
              : {}),
            ...(extracted.consistencyModel === 'CP' || extracted.consistencyModel === 'AP'
              ? { consistencyModel: extracted.consistencyModel }
              : {}),
            ...(typeof extracted.wireProtocol === 'string' && extracted.wireProtocol.trim()
              ? { wireProtocol: extracted.wireProtocol.trim() }
              : {}),
            ...(typeof extracted.primaryStorage === 'string' && extracted.primaryStorage.trim()
              ? { primaryStorage: extracted.primaryStorage.trim() }
              : {}),
          };
        }
      } catch {
        // Keep regex signals
      }
    }

    // 3. Needle 3 Local 3072-d Semantic Playbook Retrieval (indexed lazily in idle background)
    let matchedPlaybookId: string | undefined;
    if (!this.playbookEmbeddings) {
      setTimeout(() => void this.indexPlaybookEmbeddings(), 600);
    } else if (trimmed.length >= 12) {
      try {
        const qVec = await this.needle.embed(trimmed);
        let bestScore = 0.25;
        for (const item of this.playbookEmbeddings) {
          const sim = cosineSimilarity(qVec, item.vec);
          if (sim > bestScore) {
            bestScore = sim;
            matchedPlaybookId = item.id;
          }
        }
      } catch {
        // Non-fatal
      }
    }

    this.update({
      lastConfidence: confidence,
      matchedPlaybookId: matchedPlaybookId ?? this.status.matchedPlaybookId,
      lastActionSummary:
        actions.length > 0
          ? actions.map((a) => a.type.replace('_', ' ')).join(', ')
          : this.status.lastActionSummary,
    });

    return { actions, signals, matchedPlaybookId, confidence };
  }

  async dispose() {
    if (this.needle) {
      const n = this.needle;
      this.needle = null;
      await n.close();
    }
  }
}

export function extractRegexFallbackSignals(text: string): Partial<ExtractedDesignSignals> {
  const out: Partial<ExtractedDesignSignals> = {};
  const lat = text.match(/(?:<\s*|under\s+)?\b\d+\s*(?:ms|milliseconds|seconds|s)\b(?:\s*p99|\s*p95)?/i);
  if (lat) out.latencySla = lat[0].trim();

  const scale = text.match(/\b\d+(?:\.\d+)?\s*(?:M|B|k|million|billion)?\s*(?:DAU|MAU|RPS|QPS|writes\/s|events\/s|users)\b/i);
  if (scale) out.scaleTarget = scale[0].trim();

  if (/\b(CP|strong\s+consistency|strongly\s+consistent|linearizable)\b/i.test(text)) {
    out.consistencyModel = 'CP';
  } else if (/\b(AP|eventual\s+consistency|availability\s+over\s+consistency)\b/i.test(text)) {
    out.consistencyModel = 'AP';
  }

  const proto = text.match(/\b(REST|WebSockets?|SSE|Server-Sent Events|gRPC|GraphQL)\b/i);
  if (proto) out.wireProtocol = proto[1];

  const store = text.match(/\b(Postgres|PostgreSQL|MySQL|DynamoDB|Cassandra|Redis|S3|ClickHouse|Spanner|OpenSearch|Elasticsearch)\b/i);
  if (store) out.primaryStorage = store[1];

  return out;
}
