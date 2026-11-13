import { DESIGN_STAGES } from '../data/methodology';
import { serializeTopologyForLlm } from './sceneGraph';
import type {
  CandidateLevel,
  ChallengeSpec,
  CoachMessage,
  LlmBackendKind,
  LlmStatus,
  StageId,
  TopologyGraph,
} from '../types';

export interface ModelOption {
  id: string;
  label: string;
  sizeLabel: string;
  backend: LlmBackendKind;
}

export const ON_DEVICE_MODELS: ModelOption[] = [
  {
    id: 'heuristic-instant',
    label: 'Topology Graph Coach (Instant · 0 MB)',
    sizeLabel: '0 MB',
    backend: 'heuristic',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B Instruct (WebGPU)',
    sizeLabel: '~710 MB',
    backend: 'webllm',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 1.5B Instruct (WebGPU)',
    sizeLabel: '~980 MB',
    backend: 'webllm',
  },
  {
    id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
    label: 'SmolLM2 1.7B Instruct (WebGPU)',
    sizeLabel: '~1.0 GB',
    backend: 'webllm',
  },
];

interface BuiltinLanguageModel {
  promptStreaming?: (prompt: string) => AsyncIterable<string>;
  prompt: (prompt: string) => Promise<string>;
  destroy?: () => void;
}

async function detectBuiltinAi(): Promise<boolean> {
  try {
    const g = globalThis as Record<string, unknown>;
    const lm = (g.LanguageModel ?? (g.ai as Record<string, unknown> | undefined)?.languageModel) as
      | { availability?: () => Promise<string>; capabilities?: () => Promise<{ available?: string }> }
      | undefined;
    if (!lm) return false;
    if (typeof lm.availability === 'function') {
      const state = await lm.availability();
      return state === 'available' || state === 'readily';
    }
    if (typeof lm.capabilities === 'function') {
      const caps = await lm.capabilities();
      return caps?.available === 'readily' || caps?.available === 'available';
    }
    return false;
  } catch {
    return false;
  }
}

async function createBuiltinSession(systemPrompt: string): Promise<BuiltinLanguageModel | null> {
  try {
    const g = globalThis as Record<string, unknown>;
    const lm = (g.LanguageModel ?? (g.ai as Record<string, unknown> | undefined)?.languageModel) as
      | { create?: (opts?: unknown) => Promise<BuiltinLanguageModel> }
      | undefined;
    if (!lm?.create) return null;
    return await lm.create({ systemPrompt });
  } catch {
    return null;
  }
}

function buildSystemPrompt(
  challenge: ChallengeSpec,
  stage: StageId,
  level: CandidateLevel,
): string {
  const stageMeta = DESIGN_STAGES.find((s) => s.id === stage) ?? DESIGN_STAGES[0];
  const levelExpectation =
    level === 'staff'
      ? 'Bar: Staff+ (L6/E6). Expect the candidate to proactively identify hot-key skew, multi-region failure modes, inline back-of-the-envelope numbers, and operational simplicity vs. complexity trade-offs.'
      : level === 'senior'
        ? 'Bar: Senior (L5/E5). Expect clean end-to-end paths, justified storage/caching choices by access pattern, and concrete bottleneck mitigations.'
        : 'Bar: Mid-Level (L4/E4). Guide step-by-step toward a working baseline topology first, then point at specific bottlenecks to solve together.';

  return [
    `You are a calm, rigorous Distributed Systems Interviewer coaching a candidate on "${challenge.title}".`,
    levelExpectation,
    `Current phase: ${stageMeta.label} — ${stageMeta.headline}`,
    `Core capabilities expected: ${challenge.functionalGoals.join('; ')}.`,
    `Key SLAs: ${challenge.slaTargets.join('; ')}.`,
    `Rules for your response:`,
    `- Speak like a real live interviewer at a whiteboard: maximum 1 to 2 short sentences (under 30 words total).`,
    `- Reference a specific component or missing link on the board, then ask ONE crisp trade-off question.`,
    `- Never lecture, never write bullet lists, and never use emojis or markdown headers.`,
  ].join('\n');
}

export function generateHeuristicCoachReply(
  challenge: ChallengeSpec,
  stage: StageId,
  graph: TopologyGraph,
  candidateInput: string,
  priorCoachCount: number,
): { text: string; relatedNodeIds?: string[] } {
  const lower = candidateInput.toLowerCase();
  const kinds = new Set(graph.nodes.map((n) => n.kind));
  const warnFinding = graph.findings.find((f) => f.severity === 'warn');

  if (warnFinding) {
    return {
      text: `${warnFinding.title}. How will you adjust that path to protect your SLA?`,
      relatedNodeIds: warnFinding.nodeIds,
    };
  }

  if (stage === 'scope') {
    if (!/\b(\d+\s*(ms|s|sec|m|k|qps|rps|dau|gb|tb|%)|cp|ap|eventual|strong)\b/i.test(candidateInput) && candidateInput.length > 0) {
      return {
        text: `Good functional scope. Lock a concrete p99 latency target and choose CP vs. AP before moving to API contracts.`,
      };
    }
    return {
      text: `Scope is locked. Ready for Phase 2 — which wire protocol and primary write endpoint will you expose?`,
    };
  }

  if (stage === 'contracts') {
    const mentionsProtocol = /\b(rest|http|grpc|websocket|ws|sse|graphql|post|get|put)\b/i.test(lower);
    if (!mentionsProtocol) {
      return {
        text: `For ${challenge.coreEntities.slice(0, 2).join(' & ')}, will you use REST, WebSockets/SSE, or gRPC — and how are retries made idempotent?`,
      };
    }
    return {
      text: `Clean contract surface. Head to the board and wire Client -> Gateway -> Service -> Store.`,
    };
  }

  if (stage === 'topology') {
    if (graph.nodes.length === 0) {
      return {
        text: `Board is clear — stamp Starter Flow or drop Client, Gateway, Service, and Database to trace ${challenge.apiSketch[0]?.split('->')[0]?.trim() ?? 'your main path'}.`,
      };
    }
    if (graph.edges.length === 0 && graph.nodes.length >= 2) {
      return {
        text: `You placed ${graph.nodes.map((n) => n.label).slice(0, 3).join(', ')} — connect them with arrows to show request direction.`,
        relatedNodeIds: graph.nodes.slice(0, 2).map((n) => n.id),
      };
    }
    if (!kinds.has('database') && !kinds.has('blob')) {
      return {
        text: `Stateless path is up, but nothing is durable yet. Which primary store holds committed state?`,
      };
    }
    const missingExpected = challenge.expectedKinds.filter((k) => !kinds.has(k));
    if (missingExpected.length > 0) {
      return {
        text: `${graph.nodes.length} nodes wired. Where does a ${missingExpected[0]} sit on this path — or are you deferring it to Stress Drill?`,
      };
    }
    return {
      text: `Baseline topology is complete (${graph.nodes.length} nodes, ${graph.edges.length} edges). Jump to Stress Drill to test 10x load and failure modes.`,
    };
  }

  // Stage === 'hardening'
  const infoFinding = graph.findings.find((f) => f.severity === 'info');
  if (infoFinding) {
    return {
      text: `${infoFinding.title} — what breaks there first if peak traffic spikes 10x?`,
      relatedNodeIds: infoFinding.nodeIds,
    };
  }

  const probe = challenge.deepDiveProbes[priorCoachCount % challenge.deepDiveProbes.length];
  return {
    text: probe,
  };
}

export class OnDeviceLlmController {
  private worker: Worker | null = null;
  private status: LlmStatus;
  private listeners = new Set<(status: LlmStatus) => void>();
  private pending = new Map<
    string,
    {
      onToken?: (full: string) => void;
      resolve: (text: string) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor() {
    const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    this.status = {
      backend: 'heuristic',
      modelId: 'heuristic-instant',
      ready: true,
      loading: false,
      progress: 100,
      progressText: 'Instant Graph Coach ready (0 MB)',
      webgpuSupported: hasWebGpu,
      builtinSupported: false,
    };

    void detectBuiltinAi().then((supported) => {
      this.status = { ...this.status, builtinSupported: supported };
      if (supported && this.status.modelId === 'heuristic-instant') {
        this.status = {
          ...this.status,
          backend: 'builtin-ai',
          modelId: 'chrome-builtin-gemini-nano',
          progressText: 'Chrome Built-in AI (Gemini Nano) active',
        };
      }
      this.emit();
    });
  }

  async initOptimalBackgroundModel(): Promise<void> {
    try {
      const builtinSupported = await detectBuiltinAi();
      if (builtinSupported) {
        await this.selectModel('chrome-builtin-gemini-nano');
        return;
      }
      if (this.status.webgpuSupported) {
        await this.selectModel('Llama-3.2-1B-Instruct-q4f16_1-MLC');
        return;
      }
    } catch (err) {
      console.warn('[OnDeviceLLM] Background model init fell back to Instant Graph Coach:', err);
    }
  }

  getStatus(): LlmStatus {
    return this.status;
  }

  subscribe(fn: (status: LlmStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) {
      fn({ ...this.status });
    }
  }

  async selectModel(modelId: string): Promise<void> {
    if (modelId === 'heuristic-instant') {
      this.status = {
        ...this.status,
        backend: 'heuristic',
        modelId,
        ready: true,
        loading: false,
        progress: 100,
        progressText: 'Instant Graph Coach active (0 MB)',
        error: undefined,
      };
      this.emit();
      return;
    }

    if (modelId === 'chrome-builtin-gemini-nano') {
      this.status = {
        ...this.status,
        backend: 'builtin-ai',
        modelId,
        ready: true,
        loading: false,
        progress: 100,
        progressText: 'Chrome Built-in AI ready',
        error: undefined,
      };
      this.emit();
      return;
    }

    if (!this.status.webgpuSupported) {
      this.status = {
        ...this.status,
        error: 'WebGPU not detected in this browser; staying on Instant Graph Coach.',
      };
      this.emit();
      return;
    }

    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/llm.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (ev: MessageEvent) => {
        const data = ev.data;
        if (data.type === 'progress') {
          this.status = {
            ...this.status,
            loading: true,
            ready: false,
            progress: data.progress,
            progressText: data.text,
          };
          this.emit();
        } else if (data.type === 'loaded') {
          this.status = {
            ...this.status,
            backend: 'webllm',
            modelId: data.modelId,
            loading: false,
            ready: true,
            progress: 100,
            progressText: `${data.modelId.replace(/-q4f16_1-MLC$/, '')} ready on WebGPU`,
            error: undefined,
          };
          this.emit();
        } else if (data.type === 'token' && data.requestId) {
          this.pending.get(data.requestId)?.onToken?.(data.full);
        } else if (data.type === 'done' && data.requestId) {
          const req = this.pending.get(data.requestId);
          if (req) {
            this.pending.delete(data.requestId);
            req.resolve(data.full);
          }
        } else if (data.type === 'error') {
          if (data.requestId && this.pending.has(data.requestId)) {
            const req = this.pending.get(data.requestId)!;
            this.pending.delete(data.requestId);
            req.reject(new Error(data.error));
          } else {
            this.status = {
              ...this.status,
              backend: 'heuristic',
              modelId: 'heuristic-instant',
              loading: false,
              ready: true,
              error: data.error,
              progressText: 'Fell back to Instant Graph Coach',
            };
            this.emit();
          }
        }
      };
    }

    this.status = {
      ...this.status,
      backend: 'webllm',
      modelId,
      loading: true,
      ready: false,
      progress: 2,
      progressText: 'Initializing WebGPU shader cache…',
      error: undefined,
    };
    this.emit();
    this.worker.postMessage({ type: 'load', modelId });
  }

  abortGeneration() {
    this.worker?.postMessage({ type: 'abort' });
  }

  async askCoach(params: {
    challenge: ChallengeSpec;
    stage: StageId;
    level?: CandidateLevel;
    graph: TopologyGraph;
    history: CoachMessage[];
    candidateInput: string;
    onStream?: (partial: string) => void;
  }): Promise<{ text: string; engineLabel: string; relatedNodeIds?: string[] }> {
    const { challenge, stage, level = 'senior', graph, history, candidateInput, onStream } = params;
    const boardSummary = serializeTopologyForLlm(graph, stage);
    const systemPrompt = buildSystemPrompt(challenge, stage, level);

    const userPrompt = [
      `[Live Whiteboard State] ${boardSummary}`,
      candidateInput.trim()
        ? `[Candidate Statement] "${candidateInput.trim()}"`
        : `[Action] Candidate asked for a live review of the current Excalidraw architecture.`,
      `Respond in 2-3 concise sentences with a concrete architecture observation and one Socratic question.`,
    ].join('\n');

    // 1. Try Chrome Built-in Gemini Nano if active
    if (this.status.backend === 'builtin-ai' && this.status.ready) {
      const session = await createBuiltinSession(systemPrompt);
      if (session) {
        try {
          if (session.promptStreaming) {
            let acc = '';
            for await (const chunk of session.promptStreaming(userPrompt)) {
              acc = chunk.startsWith(acc) ? chunk : acc + chunk;
              onStream?.(acc);
            }
            session.destroy?.();
            if (acc.trim()) {
              return { text: acc.trim(), engineLabel: 'Gemini Nano (On-Device)' };
            }
          } else {
            const out = await session.prompt(userPrompt);
            session.destroy?.();
            if (out.trim()) {
              onStream?.(out.trim());
              return { text: out.trim(), engineLabel: 'Gemini Nano (On-Device)' };
            }
          }
        } catch {
          // Fall through cleanly to heuristic
        }
      }
    }

    // 2. Try WebLLM WebGPU worker if loaded & ready
    if (this.status.backend === 'webllm' && this.status.ready && this.worker) {
      try {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const recentMessages = history
          .filter((m) => m.role === 'coach' || m.role === 'candidate')
          .slice(-4)
          .map((m) => ({
            role: (m.role === 'coach' ? 'assistant' : 'user') as 'assistant' | 'user',
            content: m.text,
          }));

        const text = await new Promise<string>((resolve, reject) => {
          this.pending.set(requestId, { onToken: onStream, resolve, reject });
          this.worker!.postMessage({
            type: 'generate',
            requestId,
            messages: [
              { role: 'system', content: systemPrompt },
              ...recentMessages,
              { role: 'user', content: userPrompt },
            ],
          });
        });

        if (text) {
          const shortModel = this.status.modelId.replace(/-Instruct.*$/, '');
          return { text, engineLabel: `${shortModel} · WebGPU` };
        }
      } catch {
        // Fall through cleanly to heuristic
      }
    }

    // 3. Instant deterministic Topology & Socratic Coach (0 MB, <5ms)
    const coachTurns = history.filter((m) => m.role === 'coach').length;
    const reply = generateHeuristicCoachReply(challenge, stage, graph, candidateInput, coachTurns);
    onStream?.(reply.text);
    return {
      text: reply.text,
      engineLabel: 'Graph Coach · Local',
      relatedNodeIds: reply.relatedNodeIds,
    };
  }
}
