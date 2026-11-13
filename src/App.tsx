import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

import { CHALLENGES } from './data/challenges';
import { DESIGN_STAGES, STENCIL_PRESETS, TOTAL_MOCK_MINUTES } from './data/methodology';
import { INTERVIEW_PLAYBOOK, type PlaybookCard } from './data/playbook';
import { ARCHETYPE_SOLUTIONS, buildSolutionExcalidrawSkeletons } from './data/solutions';
import {
  buildArrowSkeletonBetweenNodes,
  buildStencilSkeleton,
  extractTopology,
  scoreRubric,
  type RawExcalidrawElement,
} from './lib/sceneGraph';
import {
  buildWhistleKeywords,
  CactusNeedleController,
  type CanvasToolAction,
} from './lib/cactusRuntime';
import {
  generateHeuristicCoachReply,
  OnDeviceLlmController,
} from './lib/onDeviceLlm';
import { VoicePipelineController } from './lib/voicePipeline';
import { registerSysdWebMcpTools } from './lib/webmcp';
import { LandingPage, SysdLogoMark } from './components/LandingPage';
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconMic,
  IconMicOff,
  IconMoon,
  IconPanelToggle,
  IconPause,
  IconPlay,
  IconReset,
  IconScan,
  IconSend,
  IconSun,
  IconVolume,
  IconVolumeMute,
} from './components/Icons';
import { StudioDropdown, type StudioDropdownOption } from './components/StudioDropdown';
import type {
  CandidateLevel,
  ChallengeCheck,
  ChallengeSpec,
  CoachMessage,
  ComponentKind,
  ExtractedDesignSignals,
  LlmStatus,
  MobilePane,
  NeedleStatus,
  StageId,
  TopologyGraph,
  VoiceStatus,
} from './types';

const FREE_FLOW_ID = 'free-flow';

function buildFreeFlowSpec(customTopic: string): ChallengeSpec {
  const title = customTopic.trim() || 'Free-Flow Architecture';
  return {
    id: FREE_FLOW_ID,
    title,
    subtitle: 'Open-ended topology sketching with live graph diagnostics & voice coaching',
    category: 'infrastructure',
    difficulty: 'Staff',
    summary: `Unscripted architecture workspace for ${title}. Sketch freely while the local interviewer inspects your graph and probes failure modes.`,
    functionalGoals: [
      'Define core read and write paths across stateless and stateful tiers',
      'Label wire protocols, data stores, and async boundaries cleanly',
    ],
    outOfScope: [],
    slaTargets: ['Target p99 latency & availability matched to workload'],
    coreEntities: ['Request', 'StateRecord', 'Event'],
    apiSketch: ['Client -> Gateway -> Stateless Service -> Durable Store'],
    inlineMathPrompt:
      'Size peak QPS, storage growth per day, and hot-partition fan-out right next to the bottleneck component.',
    deepDiveProbes: [
      `Looking at ${title}, which single component saturates first at 10x peak load, and how do you partition or cache around it?`,
      `What happens to in-flight writes and downstream consumers if your primary store or broker drops for 30 seconds?`,
      `Where did you trade strict consistency for lower tail latency, and how do clients observe staleness?`,
    ],
    expectedKinds: ['client', 'gateway', 'service', 'database'],
    forbidDirectClientDb: true,
    checks: [],
  };
}

function formatClock(totalSeconds: number): string {
  const abs = Math.abs(totalSeconds);
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  const prefix = totalSeconds < 0 ? '-' : '';
  return `${prefix}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function isCheckSatisfiedByBoard(check: ChallengeCheck, graph: TopologyGraph): boolean {
  const kinds = new Set(graph.nodes.map((n) => n.kind));
  if (check.requiredKinds && !check.requiredKinds.every((k) => kinds.has(k))) {
    return false;
  }
  if (check.requireEdge) {
    const [a, b] = check.requireEdge;
    const found = graph.edges.some(
      (e) => (e.fromKind === a && e.toKind === b) || (e.fromKind === b && e.toKind === a),
    );
    if (!found) return false;
  }
  return Boolean(check.requiredKinds || check.requireEdge);
}

function defaultLatencyChip(challenge: ChallengeSpec): string {
  for (const s of challenge.slaTargets) {
    const m = s.match(/(<\s*\d+\s*(?:ms|s)\b(?:\s*p99)?)/i);
    if (m) return m[1].replace(/\s+/g, ' ');
  }
  return '< 200ms p99';
}

function defaultConsistencyChip(challenge: ChallengeSpec): 'CP' | 'AP' {
  const joined = challenge.slaTargets.join(' ').toLowerCase();
  return joined.includes('cp') || joined.includes('double') || joined.includes('exact')
    ? 'CP'
    : 'AP';
}

function buildStageOpeningPrompt(
  challenge: ChallengeSpec,
  stage: StageId,
  graph: TopologyGraph,
): string {
  if (challenge.id === FREE_FLOW_ID) {
    if (graph.nodes.length === 0) {
      return `Free-flow canvas ready for "${challenge.title}". Drop components, speak out loud, or run commands like "Add Redis Cache" — I’ll critique your graph live.`;
    }
    return generateHeuristicCoachReply(challenge, 'topology', graph, '', 0).text;
  }
  if (stage === 'scope') {
    return `We’re designing ${challenge.title}. Lock your target p99 latency, CP vs. AP posture, and scale ceiling — or speak your scope in 2 sentences.`;
  }
  if (stage === 'contracts') {
    return `Name your wire protocol and core write contract for ${challenge.coreEntities
      .slice(0, 3)
      .join(', ')}. How do you keep retries idempotent?`;
  }
  if (stage === 'topology') {
    if (graph.nodes.length === 0) {
      return `Sketch the end-to-end read and write path on the whiteboard — start with Starter Flow or stamp Client, Gateway, Service, and Store.`;
    }
    return generateHeuristicCoachReply(challenge, 'topology', graph, '', 0).text;
  }
  return challenge.deepDiveProbes[0];
}

function buildStageHint(challenge: ChallengeSpec, stage: StageId): string {
  if (challenge.id === FREE_FLOW_ID) {
    return challenge.inlineMathPrompt;
  }
  if (stage === 'scope') {
    return `Target benchmark: ${challenge.slaTargets.slice(0, 2).join(' · ')}. Cut: ${challenge.outOfScope
      .slice(0, 2)
      .join(', ')}.`;
  }
  if (stage === 'contracts') {
    return `Clean contract: ${challenge.apiSketch.slice(0, 2).join('  |  ')}`;
  }
  if (stage === 'topology') {
    return `Expected building blocks: ${challenge.expectedKinds.join(' -> ')}. Label arrows with protocol or payload.`;
  }
  return `Inline sizing cue: ${challenge.inlineMathPrompt}`;
}

const LEVEL_OPTIONS: StudioDropdownOption<CandidateLevel>[] = [
  {
    value: 'mid',
    label: 'Bar: Mid-Level',
    subtitle: 'Guided baseline topology & core APIs',
    badge: 'L4',
  },
  {
    value: 'senior',
    label: 'Bar: Senior',
    subtitle: 'Access patterns, caching & bottlenecks',
    badge: 'L5',
  },
  {
    value: 'staff',
    label: 'Bar: Staff+',
    subtitle: 'Hot-key skew, failover & inline math',
    badge: 'L6',
  },
];

export function App() {
  const [view, setView] = useState<'landing' | 'studio'>(() => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#studio')) {
      return 'studio';
    }
    return 'landing';
  });
  const [isDark, setIsDark] = useState(false);
  const [challengeId, setChallengeId] = useState<string>(CHALLENGES[0].id);
  const [customTopic, setCustomTopic] = useState<string>('');
  const [stage, setStage] = useState<StageId>('scope');
  const [level, setLevel] = useState<CandidateLevel>('senior');
  const [railTab, setRailTab] = useState<'coach' | 'brief' | 'solution' | 'playbook'>('coach');
  const [playbookFilter, setPlaybookFilter] = useState<'all' | PlaybookCard['category']>('all');
  const [mobilePane, setMobilePane] = useState<MobilePane>('canvas');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [showMathHint, setShowMathHint] = useState(false);
  const [showCoachHint, setShowCoachHint] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeDrillIdx, setActiveDrillIdx] = useState<number>(0);

  const isFreeFlow = challengeId === FREE_FLOW_ID;

  const navigateToStudio = useCallback((newChallengeId?: string, freeFlowTopic?: string) => {
    if (newChallengeId) {
      setChallengeId(newChallengeId);
    }
    if (typeof freeFlowTopic === 'string') {
      setCustomTopic(freeFlowTopic);
    }
    setView('studio');
    if (typeof window !== 'undefined' && window.location.hash !== '#studio') {
      window.location.hash = '#studio';
    }
  }, []);

  const navigateToLanding = useCallback(() => {
    setView('landing');
    if (typeof window !== 'undefined' && window.location.hash !== '#landing') {
      window.location.hash = '#landing';
    }
  }, []);

  // Timer (35m mock countdown)
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_MOCK_MINUTES * 60);
  const [timerRunning, setTimerRunning] = useState(false);

  // Excalidraw & live topology
  const excalidrawApiRef = useRef<any>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const [graph, setGraph] = useState<TopologyGraph>(() => extractTopology([], CHALLENGES[0]));
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [contractTags, setContractTags] = useState<string[]>([]);

  // Opaque On-Device Controllers (Cactus Needle 3 + Cactus Whistle + Kokoro-82M + Socratic LLM)
  const llmRef = useRef<OnDeviceLlmController | null>(null);
  const needleRef = useRef<CactusNeedleController | null>(null);
  const voiceRef = useRef<VoicePipelineController | null>(null);
  const [, setLlmStatus] = useState<LlmStatus>({
    backend: 'heuristic',
    modelId: 'heuristic-instant',
    ready: true,
    loading: false,
    progress: 100,
    progressText: 'Ready',
    webgpuSupported: false,
    builtinSupported: false,
  });
  const [needleStatus, setNeedleStatus] = useState<NeedleStatus>({
    enabled: false,
    ready: false,
    loading: false,
    progress: 0,
  });
  const [extractedSignals, setExtractedSignals] = useState<ExtractedDesignSignals>({});
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({
    state: 'off',
    vadBackend: 'wasm-vad',
    sttChoice: 'whistle',
    sttBackend: 'Cactus Whistle · 16.9 MB WASM',
    sttReady: false,
    sttLoading: false,
    sttProgress: 0,
    ttsEnabled: true,
    level: 0,
    probability: 0,
    interimTranscript: '',
  });
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [draftInput, setDraftInput] = useState('');
  const [busyCoach, setBusyCoach] = useState(false);

  const challenge = useMemo<ChallengeSpec>(() => {
    if (challengeId === FREE_FLOW_ID) {
      return buildFreeFlowSpec(customTopic);
    }
    return CHALLENGES.find((c) => c.id === challengeId) ?? CHALLENGES[0];
  }, [challengeId, customTopic]);

  const activeSolution = useMemo(
    () => (isFreeFlow ? undefined : ARCHETYPE_SOLUTIONS[challenge.id]),
    [challenge.id, isFreeFlow],
  );

  const challengeOptions = useMemo<StudioDropdownOption<string>[]>(
    () => [
      {
        value: FREE_FLOW_ID,
        label: 'Free-Flow Architecture',
        subtitle: 'Open canvas + custom topic prompt',
        badge: 'OPEN · ANY',
      },
      ...CHALLENGES.map((c) => ({
        value: c.id,
        label: c.title,
        subtitle: c.subtitle,
        badge: `${c.category === 'product' ? 'PRODUCT' : 'INFRA'} · ${c.difficulty}`,
      })),
    ],
    [],
  );

  // Sync latest refs for async voice callback
  const latestContextRef = useRef({ challenge, stage, level, graph, messages });
  latestContextRef.current = { challenge, stage, level, graph, messages };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Sync view state with browser URL hash & back/forward history
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#studio')) {
        setView('studio');
      } else if (hash === '#landing' || hash === '' || hash === '#/') {
        setView('landing');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, []);

  // Seed opening coach prompt whenever challengeId changes
  useEffect(() => {
    setShowMathHint(false);
    setShowCoachHint(false);
    setShowHistory(false);
    setExtractedSignals({});
    setContractTags([]);
    setManualChecks({});
    setActiveDrillIdx(0);
    setRailTab('coach');
    const initialStage: StageId = challengeId === FREE_FLOW_ID ? 'topology' : 'scope';
    setStage(initialStage);
    setSecondsLeft(TOTAL_MOCK_MINUTES * 60);
    setTimerRunning(false);
    const activeSpec =
      challengeId === FREE_FLOW_ID
        ? buildFreeFlowSpec(customTopic)
        : CHALLENGES.find((c) => c.id === challengeId) ?? CHALLENGES[0];
    const elements = (excalidrawApiRef.current?.getSceneElements?.() ?? []) as RawExcalidrawElement[];
    const nextGraph = extractTopology(elements, activeSpec);
    setGraph(nextGraph);
    setMessages([
      {
        id: `open_${challengeId}`,
        role: 'coach',
        stage: initialStage,
        timestamp: Date.now(),
        engineLabel: 'Interviewer',
        text: buildStageOpeningPrompt(activeSpec, initialStage, nextGraph),
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId]);

  // Timer interval
  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  const pushCoachPrompt = useCallback(
    (text: string, nextStage?: StageId, engineLabel = 'Interviewer', relatedNodeIds?: string[]) => {
      const targetStage = nextStage ?? latestContextRef.current.stage;
      setMessages((prev) => [
        ...prev,
        {
          id: `coach_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'coach',
          stage: targetStage,
          timestamp: Date.now(),
          engineLabel,
          text,
          relatedNodeIds,
        },
      ]);
    },
    [],
  );

  const handleSelectStage = useCallback(
    (nextStage: StageId) => {
      setStage(nextStage);
      setShowCoachHint(false);
      const prompt = buildStageOpeningPrompt(
        latestContextRef.current.challenge,
        nextStage,
        latestContextRef.current.graph,
      );
      pushCoachPrompt(prompt, nextStage);
    },
    [pushCoachPrompt],
  );

  const applyNeedleToolActions = useCallback(
    (actions: CanvasToolAction[]): string[] => {
      const summaries: string[] = [];
      const api = excalidrawApiRef.current;

      for (const act of actions) {
        if (act.type === 'add_component' && api) {
          const existing = (api.getSceneElements() ?? []) as RawExcalidrawElement[];
          const skeletons = buildStencilSkeleton(act.kind, existing, isDark, act.label);
          const created = convertToExcalidrawElements(skeletons as any);
          const updated = [...existing, ...created];
          api.updateScene({ elements: updated });
          const nextG = extractTopology(updated as RawExcalidrawElement[], latestContextRef.current.challenge);
          latestContextRef.current.graph = nextG;
          setGraph(nextG);
          summaries.push(`Stamped ${act.label || act.kind}`);
        } else if (act.type === 'connect_components' && api) {
          const currentGraph = latestContextRef.current.graph;
          const from = currentGraph.nodes.find((n) =>
            n.label.toLowerCase().includes(act.fromLabel.toLowerCase()),
          );
          const to = currentGraph.nodes.find((n) =>
            n.label.toLowerCase().includes(act.toLabel.toLowerCase()),
          );
          if (from && to && from.id !== to.id) {
            const existing = (api.getSceneElements() ?? []) as RawExcalidrawElement[];
            const arrowSkel = buildArrowSkeletonBetweenNodes(from, to, isDark, act.protocol);
            const created = convertToExcalidrawElements(arrowSkel as any);
            const updated = [...existing, ...created];
            api.updateScene({ elements: updated });
            const nextG = extractTopology(updated as RawExcalidrawElement[], latestContextRef.current.challenge);
            latestContextRef.current.graph = nextG;
            setGraph(nextG);
            summaries.push(
              `Wired ${from.label} -> ${to.label}${act.protocol ? ` (${act.protocol})` : ''}`,
            );
          }
        } else if (act.type === 'set_stage') {
          setStage(act.stage);
          summaries.push(`Moved to ${act.stage}`);
        } else if (act.type === 'select_challenge') {
          setChallengeId(act.challengeId);
          summaries.push(`Loaded ${act.challengeId}`);
        } else if (act.type === 'control_timer') {
          if (act.action === 'start') setTimerRunning(true);
          else if (act.action === 'pause') setTimerRunning(false);
          else {
            setTimerRunning(false);
            setSecondsLeft(TOTAL_MOCK_MINUTES * 60);
          }
          summaries.push(`Timer ${act.action}`);
        } else if (act.type === 'clear_board' && api) {
          api.updateScene({ elements: [] });
          setGraph(extractTopology([], latestContextRef.current.challenge));
          summaries.push('Cleared board');
        }
      }
      return summaries;
    },
    [isDark],
  );

  const submitCandidateTurn = useCallback(
    async (text: string, source: 'voice' | 'text' | 'board') => {
      const ctx = latestContextRef.current;
      const llm = llmRef.current;
      if (!llm) return;

      const trimmed = text.trim();

      let actionSummaries: string[] = [];
      if (trimmed && source !== 'board' && needleRef.current) {
        const nodeLabels = ctx.graph.nodes.map((n) => n.label);
        const analysis = await needleRef.current.analyzeCandidateTurn(trimmed, nodeLabels);
        if (Object.keys(analysis.signals).length > 0) {
          setExtractedSignals((prev) => ({ ...prev, ...analysis.signals }));
        }
        if (analysis.actions.length > 0) {
          actionSummaries = applyNeedleToolActions(analysis.actions);
        }
      }

      if (actionSummaries.length > 0) {
        const nextHint = generateHeuristicCoachReply(
          ctx.challenge,
          latestContextRef.current.stage,
          latestContextRef.current.graph,
          '',
          ctx.messages.length,
        );
        const replyText = `${actionSummaries.join(' · ')}. ${nextHint.text}`;
        setMessages((prev) => [
          ...prev,
          {
            id: `cand_${Date.now()}`,
            role: 'candidate',
            text: trimmed,
            timestamp: Date.now(),
            stage: ctx.stage,
            source,
          },
          {
            id: `needle_${Date.now()}`,
            role: 'coach',
            engineLabel: 'Interviewer',
            text: replyText,
            timestamp: Date.now(),
            stage: latestContextRef.current.stage,
            relatedNodeIds: nextHint.relatedNodeIds,
          },
        ]);
        if (source === 'voice' || voiceRef.current?.getStatus().state !== 'off') {
          voiceRef.current?.speakCoachReply(replyText);
        }
        return;
      }

      const coachMsgId = `coach_${Date.now()}`;

      setMessages((prev) => {
        const next = [...prev];
        if (trimmed && source !== 'board') {
          next.push({
            id: `cand_${Date.now()}`,
            role: 'candidate',
            text: trimmed,
            timestamp: Date.now(),
            stage: ctx.stage,
            source,
          });
        }
        next.push({
          id: coachMsgId,
          role: 'coach',
          text: 'Reviewing board…',
          timestamp: Date.now(),
          stage: ctx.stage,
          streaming: true,
        });
        return next;
      });

      setBusyCoach(true);
      try {
        const reply = await llm.askCoach({
          challenge: ctx.challenge,
          stage: ctx.stage,
          level: ctx.level,
          graph: latestContextRef.current.graph,
          history: ctx.messages,
          candidateInput: trimmed,
          onStream: (partial) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === coachMsgId ? { ...m, text: partial } : m)),
            );
          },
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === coachMsgId
              ? {
                  ...m,
                  text: reply.text,
                  engineLabel: 'Interviewer',
                  streaming: false,
                  relatedNodeIds: reply.relatedNodeIds,
                }
              : m,
          ),
        );

        if (source === 'voice' || voiceRef.current?.getStatus().state !== 'off') {
          voiceRef.current?.speakCoachReply(reply.text);
        }
      } finally {
        setBusyCoach(false);
      }
    },
    [applyNeedleToolActions],
  );

  // Opaque concurrent model preloading on mount (Needle 3 + Whistle + Kokoro-82M + Coach LLM)
  useEffect(() => {
    const llm = new OnDeviceLlmController();
    llmRef.current = llm;
    const unsubLlm = llm.subscribe(setLlmStatus);

    const needle = new CactusNeedleController();
    needleRef.current = needle;
    const unsubNeedle = needle.subscribe(setNeedleStatus);

    const voice = new VoicePipelineController({
      onTranscript: (spokenText) => {
        void submitCandidateTurn(spokenText, 'voice');
      },
      onBargeIn: () => {
        llm.abortGeneration();
      },
      getKeywords: () =>
        buildWhistleKeywords(latestContextRef.current.challenge, latestContextRef.current.graph),
    });
    voiceRef.current = voice;
    const unsubVoice = voice.subscribe(setVoiceStatus);

    void needle.enable();
    void voice.preloadAudioModels();
    void llm.initOptimalBackgroundModel();

    return () => {
      unsubLlm();
      unsubNeedle();
      unsubVoice();
      void needle.dispose();
      void voice.dispose();
    };
  }, [submitCandidateTurn]);

  // Proactive board-aware interviewer feedback when topology changes
  const lastCoachedFpRef = useRef<string>('');
  useEffect(() => {
    if (graph.nodes.length === 0) {
      lastCoachedFpRef.current = graph.fingerprint;
      return;
    }
    if (graph.fingerprint === lastCoachedFpRef.current) return;
    lastCoachedFpRef.current = graph.fingerprint;

    const timer = window.setTimeout(() => {
      const ctx = latestContextRef.current;
      if (ctx.challenge.id === FREE_FLOW_ID || ctx.stage === 'topology' || ctx.stage === 'hardening') {
        const obs = generateHeuristicCoachReply(
          ctx.challenge,
          ctx.challenge.id === FREE_FLOW_ID ? 'topology' : ctx.stage,
          graph,
          '',
          ctx.messages.length,
        );
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'coach' && last.text === obs.text) return prev;
          return [
            ...prev,
            {
              id: `board_${Date.now()}`,
              role: 'coach',
              stage: ctx.stage,
              timestamp: Date.now(),
              engineLabel: 'Board Watch',
              text: obs.text,
              relatedNodeIds: obs.relatedNodeIds,
            },
          ];
        });
      }
    }, 520);

    return () => window.clearTimeout(timer);
  }, [graph]);

  const handleExcalidrawChange = useCallback((elements: readonly any[]) => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      const nextGraph = extractTopology(
        elements as RawExcalidrawElement[],
        latestContextRef.current.challenge,
      );
      setGraph((prev) => (prev.fingerprint === nextGraph.fingerprint ? prev : nextGraph));
    }, 320);
  }, []);

  const handleStampStencil = useCallback(
    (kind: ComponentKind) => {
      const api = excalidrawApiRef.current;
      if (!api) return;
      const existing = (api.getSceneElements() ?? []) as RawExcalidrawElement[];
      const skeletons = buildStencilSkeleton(kind, existing, isDark);
      const created = convertToExcalidrawElements(skeletons as any);
      const updated = [...existing, ...created];
      api.updateScene({ elements: updated });
      setGraph(extractTopology(updated as RawExcalidrawElement[], challenge));
      if (!isFreeFlow && (stage === 'scope' || stage === 'contracts')) {
        setStage('topology');
      }
    },
    [challenge, isDark, isFreeFlow, stage],
  );

  const handleSeedStarterFlow = useCallback(() => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    const existing = (api.getSceneElements() ?? []).filter((e: any) => !e.isDeleted);
    const yBase = existing.length > 0 ? 320 : 140;
    const skeletons: any[] = [
      {
        type: 'rectangle',
        id: 'seed_client',
        x: 90,
        y: yBase,
        width: 164,
        height: 72,
        strokeColor: isDark ? '#e6e8eb' : '#1f2328',
        backgroundColor: isDark ? '#1f2329' : '#f6f5f1',
        fillStyle: 'solid',
        strokeWidth: 1.5,
        roughness: 0,
        roundness: { type: 3 },
        customData: { kind: 'client' },
        label: { text: 'Client App', fontSize: 16 },
      },
      {
        type: 'diamond',
        id: 'seed_gw',
        x: 330,
        y: yBase - 6,
        width: 174,
        height: 84,
        strokeColor: isDark ? '#e2e8f0' : '#1f2328',
        backgroundColor: isDark ? '#262930' : '#f1efe9',
        fillStyle: 'solid',
        strokeWidth: 1.5,
        roughness: 0,
        customData: { kind: 'gateway' },
        label: { text: 'API Gateway', fontSize: 15 },
      },
      {
        type: 'rectangle',
        id: 'seed_svc',
        x: 585,
        y: yBase,
        width: 174,
        height: 72,
        strokeColor: isDark ? '#f1f5f9' : '#0f172a',
        backgroundColor: isDark ? '#181b20' : '#ffffff',
        fillStyle: 'solid',
        strokeWidth: 1.5,
        roughness: 0,
        roundness: { type: 3 },
        customData: { kind: 'service' },
        label: { text: 'Core Service', fontSize: 16 },
      },
      {
        type: 'arrow',
        x: 258,
        y: yBase + 36,
        points: [
          [0, 0],
          [68, 0],
        ],
        strokeColor: isDark ? '#cbd5e1' : '#334155',
        strokeWidth: 1.5,
        roughness: 0,
        start: { id: 'seed_client' },
        end: { id: 'seed_gw' },
        label: { text: 'HTTPS', fontSize: 13 },
      },
      {
        type: 'arrow',
        x: 508,
        y: yBase + 36,
        points: [
          [0, 0],
          [72, 0],
        ],
        strokeColor: isDark ? '#cbd5e1' : '#334155',
        strokeWidth: 1.5,
        roughness: 0,
        start: { id: 'seed_gw' },
        end: { id: 'seed_svc' },
      },
    ];
    const created = convertToExcalidrawElements(skeletons);
    const merged = [...existing, ...created];
    api.updateScene({ elements: merged });
    api.scrollToContent?.(created, { fitToViewport: false });
    setStage('topology');
    setGraph(extractTopology(merged as RawExcalidrawElement[], challenge));
  }, [challenge, isDark]);

  const handleStampReferenceSolution = useCallback(() => {
    if (!activeSolution) return;
    const runStamp = (attempt = 0) => {
      const api = excalidrawApiRef.current;
      if (!api) {
        if (attempt < 15) setTimeout(() => runStamp(attempt + 1), 60);
        return;
      }
      const skeletons = buildSolutionExcalidrawSkeletons(activeSolution, isDark);
      const created = convertToExcalidrawElements(skeletons as any);
      api.updateScene({ elements: created });
      requestAnimationFrame(() => {
        api.scrollToContent?.(created, { fitToViewport: true, viewportZoomFactor: 0.88 } as any);
      });
      const nextG = extractTopology(created as RawExcalidrawElement[], challenge);
      latestContextRef.current.graph = nextG;
      setGraph(nextG);
      setStage('hardening');
      setMobilePane('canvas');
      pushCoachPrompt(
        `Reference blueprint for ${challenge.title} loaded (${nextG.nodes.length} nodes, ${nextG.edges.length} edges). Walk me through the critical bottleneck path.`,
        'hardening',
        'Reference Blueprint',
      );
    };
    runStamp(0);
  }, [activeSolution, challenge, isDark, pushCoachPrompt]);

  useEffect(() => {
    registerSysdWebMcpTools({
      openChallenge: (id, topic) => navigateToStudio(id, topic),
      stampSolution: (id) => {
        const targetId = id || challengeId;
        const sol = ARCHETYPE_SOLUTIONS[targetId];
        const ch = CHALLENGES.find((c) => c.id === targetId) ?? challenge;
        const api = excalidrawApiRef.current;
        if (!api || !sol) return null;
        const skeletons = buildSolutionExcalidrawSkeletons(sol, isDark);
        const created = convertToExcalidrawElements(skeletons as any);
        api.updateScene({ elements: created });
        api.scrollToContent?.(created, { fitToViewport: true });
        const nextG = extractTopology(created as RawExcalidrawElement[], ch);
        latestContextRef.current.graph = nextG;
        setGraph(nextG);
        return nextG;
      },
      getGraph: () => latestContextRef.current.graph,
    });
  }, [challenge, challengeId, isDark, navigateToStudio]);

  const handleClearCanvas = useCallback(() => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    api.updateScene({ elements: [] });
    setGraph(extractTopology([], challenge));
  }, [challenge]);

  const focusCanvasNodes = useCallback((nodeIds?: string[]) => {
    const api = excalidrawApiRef.current;
    if (!api || !nodeIds || nodeIds.length === 0) return;
    const all = (api.getSceneElements() ?? []) as any[];
    const targets = all.filter((e) => nodeIds.includes(e.id));
    if (targets.length > 0) {
      setMobilePane('canvas');
      api.scrollToContent?.(targets, { fitToViewport: false, animate: true });
      const selectedElementIds: Record<string, boolean> = {};
      for (const id of nodeIds) selectedElementIds[id] = true;
      api.updateScene({ appState: { selectedElementIds } });
    }
  }, []);

  const toggleVoice = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice) return;
    if (voiceStatus.state === 'off') {
      await voice.startHandsFree();
    } else {
      await voice.stopHandsFree();
    }
  }, [voiceStatus.state]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftInput.trim() || busyCoach) return;
    const text = draftInput;
    setDraftInput('');
    void submitCandidateTurn(text, 'text');
  };

  // Interactive 1-click scope / contract / drill handlers
  const handleCommitScopeSignal = useCallback(
    (field: keyof ExtractedDesignSignals, value: any) => {
      setExtractedSignals((prev) => {
        const next = { ...prev, [field]: prev[field] === value ? undefined : value };
        const hasBoth = Boolean(next.latencySla && next.consistencyModel);
        if (hasBoth) {
          pushCoachPrompt(
            `Locked ${next.latencySla} with ${next.consistencyModel}. Ready to define your wire protocol & API contract in Phase 02?`,
            'scope',
            'Interviewer',
          );
        }
        return next;
      });
      if (!timerRunning) setTimerRunning(true);
    },
    [pushCoachPrompt, timerRunning],
  );

  const handleToggleContractTag = useCallback(
    (tag: string, isProtocol = false) => {
      if (isProtocol) {
        setExtractedSignals((prev) => ({
          ...prev,
          wireProtocol: prev.wireProtocol === tag ? undefined : tag,
        }));
      } else {
        setContractTags((prev) =>
          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
        );
      }
      pushCoachPrompt(
        `Noted ${tag} on the contract surface. Stamp Starter Flow when you’re ready to trace the path on the board.`,
        'contracts',
        'Interviewer',
      );
    },
    [pushCoachPrompt],
  );

  const handleSelectDrill = useCallback(
    (idx: number) => {
      setActiveDrillIdx(idx);
      if (!isFreeFlow) setStage('hardening');
      const probe = challenge.deepDiveProbes[idx] ?? challenge.deepDiveProbes[0];
      const hotNode =
        graph.nodes.find((n) => n.kind === 'database' || n.kind === 'cache' || n.kind === 'service')
          ?.id;
      pushCoachPrompt(probe, 'hardening', `Stress Drill #${idx + 1}`, hotNode ? [hotNode] : undefined);
      if (hotNode) focusCanvasNodes([hotNode]);
    },
    [challenge.deepDiveProbes, focusCanvasNodes, graph.nodes, isFreeFlow, pushCoachPrompt],
  );

  // Checklist & Rubric computation
  const checkStates = useMemo(() => {
    return challenge.checks.map((chk) => {
      const auto = isCheckSatisfiedByBoard(chk, graph);
      const checked = auto || Boolean(manualChecks[chk.id]);
      return { ...chk, auto, checked };
    });
  }, [challenge.checks, graph, manualChecks]);

  const checkedCount = checkStates.filter((c) => c.checked).length;
  const signalCommitmentCount =
    Object.values(extractedSignals).filter(Boolean).length + contractTags.length;
  const effectiveTurns =
    messages.filter((m) => m.role === 'candidate').length + signalCommitmentCount;

  const rubricScores = useMemo(
    () =>
      scoreRubric(
        graph,
        challenge,
        effectiveTurns,
        isFreeFlow ? Math.min(3, graph.nodes.length) : checkedCount,
        isFreeFlow ? 3 : checkStates.length,
      ),
    [graph, challenge, effectiveTurns, isFreeFlow, checkedCount, checkStates.length],
  );

  const latestCoachMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'coach') return messages[i];
    }
    return null;
  }, [messages]);

  const latestVoiceCandidateMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'candidate' && messages[i].source === 'voice') return messages[i];
    }
    return null;
  }, [messages]);

  const warnFinding = useMemo(
    () => graph.findings.find((f) => f.severity === 'warn'),
    [graph.findings],
  );

  const missingBoardKinds = useMemo(() => {
    const present = new Set(graph.nodes.map((n) => n.kind));
    return challenge.expectedKinds.filter((k) => !present.has(k));
  }, [challenge.expectedKinds, graph.nodes]);

  const stageDoneMap: Record<StageId, boolean> = {
    scope: Boolean(extractedSignals.latencySla || extractedSignals.consistencyModel),
    contracts: Boolean(extractedSignals.wireProtocol || contractTags.length > 0),
    topology: graph.nodes.length >= 3 && graph.edges.length >= 2,
    hardening: checkStates.length > 0 && checkedCount >= Math.max(2, checkStates.length - 1),
  };

  const activeVoiceLabel =
    voiceStatus.state === 'off'
      ? 'Voice'
      : voiceStatus.state === 'loading'
        ? 'Starting…'
        : voiceStatus.state === 'speaking-user'
          ? 'Listening…'
          : voiceStatus.state === 'transcribing'
            ? 'Transcribing…'
            : voiceStatus.state === 'speaking-coach'
              ? 'Speaking'
              : 'Live Mic';

  const latencyTargetChip = defaultLatencyChip(challenge);
  const preferredCapChip = defaultConsistencyChip(challenge);
  const altCapChip: 'CP' | 'AP' = preferredCapChip === 'CP' ? 'AP' : 'CP';

  if (view === 'landing') {
    return (
      <LandingPage
        onStartPractice={navigateToStudio}
        theme={isDark ? 'dark' : 'light'}
        onToggleTheme={() => setIsDark((d) => !d)}
      />
    );
  }

  return (
    <div className="studio-shell">
      {/* Top Studio Header */}
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="brand-mark"
            onClick={navigateToLanding}
            aria-label="Return to sysd home"
            title="Return to sysd home"
          >
            <SysdLogoMark size={15} />
            <span>sysd</span>
          </button>

          <StudioDropdown
            id="challenge-picker"
            ariaLabel="Select system design challenge or free-flow mode"
            value={challengeId}
            options={challengeOptions}
            onChange={(id) => setChallengeId(id)}
            triggerBadge={
              isFreeFlow
                ? 'OPEN · FREE-FLOW'
                : `${challenge.category === 'product' ? 'PRODUCT' : 'INFRA'} · ${challenge.difficulty}`
            }
            menuWidth={360}
          />
        </div>

        <div className="topbar-center hide-mobile">
          <div className="timer-group" role="group" aria-label="Interview pacing timer">
            <span className={`timer-readout ${secondsLeft < 0 ? 'overtime' : ''}`}>
              {formatClock(secondsLeft)}
            </span>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => setTimerRunning((r) => !r)}
              aria-label={timerRunning ? 'Pause timer' : 'Start 35-minute timer'}
              title={timerRunning ? 'Pause timer' : 'Start 35m timer'}
            >
              {timerRunning ? <IconPause /> : <IconPlay />}
            </button>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => {
                setTimerRunning(false);
                setSecondsLeft(TOTAL_MOCK_MINUTES * 60);
              }}
              aria-label="Reset timer"
              title="Reset 35m timer"
            >
              <IconReset />
            </button>
          </div>

          <StudioDropdown
            id="level-picker"
            ariaLabel="Target interview level"
            value={level}
            options={LEVEL_OPTIONS}
            onChange={(val) => setLevel(val)}
            menuWidth={264}
          />
        </div>

        <div className="topbar-right">
          {!isFreeFlow && activeSolution && (
            <button
              type="button"
              id="topbar-solution-btn"
              className="pill-btn hide-mobile"
              onClick={() => {
                setRailCollapsed(false);
                setRailTab('solution');
              }}
              title="Inspect reference architecture solution"
            >
              <span>Solution</span>
            </button>
          )}

          <button
            type="button"
            id="theme-toggle-btn"
            className="icon-btn"
            onClick={() => setIsDark((d) => !d)}
            aria-label={isDark ? 'Switch to light paper theme' : 'Switch to dark carbon theme'}
            title="Toggle theme"
          >
            {isDark ? <IconSun /> : <IconMoon />}
          </button>

          <button
            type="button"
            className="icon-btn hide-mobile"
            onClick={() => setRailCollapsed((c) => !c)}
            aria-label={railCollapsed ? 'Expand studio coach panel' : 'Collapse studio coach panel'}
            title={railCollapsed ? 'Show panel' : 'Hide panel'}
          >
            <IconPanelToggle />
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="workspace-main">
        {/* Left/Primary Excalidraw Canvas */}
        <section
          className={`canvas-stage ${mobilePane !== 'canvas' ? 'mobile-hidden-pane' : ''}`}
          aria-label="Architecture Whiteboard"
        >
          <div className="topology-badge">
            <span>{graph.nodes.length} nodes</span>
            <span>·</span>
            <span>{graph.edges.length} edges</span>
          </div>

          <div className="excalidraw-host">
            <Excalidraw
              excalidrawAPI={(api) => {
                excalidrawApiRef.current = api;
              }}
              theme={isDark ? 'dark' : 'light'}
              onChange={handleExcalidrawChange}
              UIOptions={{
                canvasActions: {
                  toggleTheme: false,
                  changeViewBackgroundColor: false,
                },
              }}
            />
          </div>

          {/* Minimal Quick-Stamp Architecture Primitives Bar */}
          <div className="stencil-dock" role="toolbar" aria-label="Architecture component stencils">
            {STENCIL_PRESETS.map((preset) => (
              <button
                key={preset.kind}
                type="button"
                data-stencil={preset.kind}
                className="stencil-chip"
                onClick={() => handleStampStencil(preset.kind)}
                title={`Add ${preset.defaultTitle}`}
              >
                + {preset.label}
              </button>
            ))}
            <span className="stencil-divider" aria-hidden="true" />
            <button
              type="button"
              id="starter-flow-btn"
              className="stencil-chip emphasis"
              onClick={handleSeedStarterFlow}
              title="Insert connected Client -> Gateway -> Service starter flow"
            >
              Starter Flow
            </button>
            {graph.nodes.length > 0 && (
              <button
                type="button"
                className="stencil-chip"
                onClick={handleClearCanvas}
                title="Clear board"
              >
                Clear
              </button>
            )}
          </div>
        </section>

        {/* Right Studio Rail */}
        <aside
          className={`studio-rail ${railCollapsed ? 'collapsed' : ''} ${
            mobilePane === 'canvas' ? 'mobile-hidden-pane' : ''
          }`}
          aria-label="Interviewer Coach and Challenge Spec"
        >
          {isFreeFlow ? (
            <div className="freeflow-topic-bar">
              <span className="spec-heading">FREE-FLOW TOPIC</span>
              <input
                type="text"
                id="freeflow-topic-input"
                className="composer-input"
                placeholder="Custom system (e.g. Stripe Webhooks, Multi-Region KV)…"
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
              />
            </div>
          ) : (
            <nav className="stage-stepper" aria-label="Design interview stages">
              {DESIGN_STAGES.map((st) => {
                const done = stageDoneMap[st.id];
                return (
                  <button
                    key={st.id}
                    type="button"
                    data-stage={st.id}
                    className={`stage-step ${stage === st.id ? 'active' : ''} ${done ? 'done' : ''}`}
                    onClick={() => handleSelectStage(st.id)}
                  >
                    <span className="stage-step-num">
                      {done ? <IconCheck size={10} /> : `0${st.index}`} · {st.targetMinutes}m
                    </span>
                    <span className="stage-step-name">{st.shortLabel}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {/* Rail Tabs */}
          <div
            className={`rail-tabs ${isFreeFlow ? 'two-col' : 'four-col'}`}
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={railTab === 'coach'}
              className={`rail-tab ${railTab === 'coach' ? 'active' : ''}`}
              onClick={() => {
                setRailTab('coach');
                if (mobilePane !== 'canvas') setMobilePane('coach');
              }}
            >
              Interview
            </button>
            {!isFreeFlow && (
              <button
                type="button"
                role="tab"
                aria-selected={railTab === 'brief'}
                className={`rail-tab ${railTab === 'brief' ? 'active' : ''}`}
                onClick={() => {
                  setRailTab('brief');
                  if (mobilePane !== 'canvas') setMobilePane('brief');
                }}
              >
                Spec ({checkedCount}/{checkStates.length})
              </button>
            )}
            {!isFreeFlow && (
              <button
                type="button"
                role="tab"
                data-tab="solution"
                aria-selected={railTab === 'solution'}
                className={`rail-tab ${railTab === 'solution' ? 'active' : ''}`}
                onClick={() => {
                  setRailTab('solution');
                  if (mobilePane !== 'canvas') setMobilePane('brief');
                }}
              >
                Solution
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={railTab === 'playbook'}
              className={`rail-tab ${railTab === 'playbook' ? 'active' : ''}`}
              onClick={() => {
                setRailTab('playbook');
                if (mobilePane !== 'canvas') setMobilePane('playbook');
              }}
            >
              Playbook
            </button>
          </div>

          {railTab === 'coach' ? (
            <>
              <div className="rail-body">
                {/* Focused Single-Question Interviewer Card */}
                <section className="interviewer-card" aria-live="polite">
                  <div className="interviewer-head">
                    <div className="interviewer-badge">
                      <span className={`status-dot ${busyCoach ? 'loading' : 'ready'}`} />
                      <span>{latestCoachMsg?.engineLabel ?? 'Interviewer'}</span>
                      <span className="interviewer-sep">·</span>
                      <span>{isFreeFlow ? 'FREE-FLOW' : level.toUpperCase()}</span>
                    </div>

                    <div className="interviewer-controls">
                      <button
                        type="button"
                        id="voice-toggle-btn"
                        className={`mini-action-btn ${voiceStatus.state !== 'off' ? 'live' : ''}`}
                        onClick={() => void toggleVoice()}
                        aria-pressed={voiceStatus.state !== 'off'}
                        title="Hands-free voice interview"
                      >
                        {voiceStatus.state === 'off' ? <IconMicOff size={12} /> : <IconMic size={12} />}
                        <span>{activeVoiceLabel}</span>
                      </button>

                      {voiceStatus.state !== 'off' && (
                        <button
                          type="button"
                          className="icon-btn sm"
                          onClick={() => voiceRef.current?.setTtsEnabled(!voiceStatus.ttsEnabled)}
                          aria-label={voiceStatus.ttsEnabled ? 'Mute spoken replies' : 'Unmute spoken replies'}
                        >
                          {voiceStatus.ttsEnabled ? <IconVolume size={13} /> : <IconVolumeMute size={13} />}
                        </button>
                      )}

                      <button
                        type="button"
                        id="audit-board-btn"
                        className="mini-action-btn"
                        disabled={busyCoach}
                        onClick={() => void submitCandidateTurn('', 'board')}
                        title="Audit current whiteboard topology"
                      >
                        <IconScan size={12} />
                        <span>Audit</span>
                      </button>
                    </div>
                  </div>

                  {voiceStatus.state !== 'off' && (
                    <div className={`voice-live-strip state-${voiceStatus.state}`} role="status">
                      <div className="voice-live-left">
                        <span className="voice-pulse-dot" />
                        <span className="voice-state-label">
                          {voiceStatus.state === 'loading'
                            ? 'WARMING VAD + WHISTLE'
                            : voiceStatus.state === 'speaking-user'
                              ? 'USER SPEAKING · BARGE-IN'
                              : voiceStatus.state === 'transcribing'
                                ? 'WHISTLE WASM · DECODING'
                                : voiceStatus.state === 'speaking-coach'
                                  ? 'KOKORO-82M · SPEAKING'
                                  : 'HANDS-FREE · VAD LIVE'}
                        </span>
                      </div>
                      <div className="voice-meter" aria-hidden="true">
                        {[0.38, 0.72, 1.0, 0.64, 0.92, 0.84, 1.0, 0.58, 0.76, 0.44].map((w, idx) => {
                          const base =
                            voiceStatus.state === 'speaking-coach'
                              ? 0.58
                              : voiceStatus.state === 'transcribing'
                                ? 0.34
                                : Math.max(0.14, voiceStatus.level);
                          const h = Math.max(3, Math.min(14, Math.round(base * w * 14)));
                          return <span key={idx} className="voice-meter-bar" style={{ height: `${h}px` }} />;
                        })}
                      </div>
                      <span className="voice-engine-tag">{voiceStatus.sttBackend}</span>
                    </div>
                  )}

                  {voiceStatus.state !== 'off' &&
                    (voiceStatus.interimTranscript || latestVoiceCandidateMsg) && (
                      <div className="interim-pill">
                        <span className="voice-you-tag">You · Voice:</span>{' '}
                        “{voiceStatus.interimTranscript || latestVoiceCandidateMsg?.text}”
                      </div>
                    )}

                  <div
                    className="interviewer-prompt"
                    onClick={() =>
                      latestCoachMsg?.relatedNodeIds && focusCanvasNodes(latestCoachMsg.relatedNodeIds)
                    }
                  >
                    {latestCoachMsg?.text ?? buildStageOpeningPrompt(challenge, stage, graph)}
                  </div>

                  <div className="interviewer-subrow">
                    <button
                      type="button"
                      className="hint-toggle"
                      onClick={() => setShowCoachHint((h) => !h)}
                    >
                      {showCoachHint ? 'Hide cue' : 'Show cue'}
                    </button>
                    {!isFreeFlow && activeSolution && (
                      <button
                        type="button"
                        className="hint-toggle"
                        onClick={() => setRailTab('solution')}
                      >
                        View reference solution
                      </button>
                    )}
                  </div>

                  {showCoachHint && (
                    <div className="coach-cue-box">{buildStageHint(challenge, stage)}</div>
                  )}

                  {/* Stage-Specific 1-Click Coaching Decisions */}
                  <div className="coach-action-tray">
                    {isFreeFlow ? (
                      <>
                        {graph.nodes.length === 0 && (
                          <button
                            type="button"
                            className="decision-chip locked"
                            onClick={handleSeedStarterFlow}
                          >
                            + Seed Starter Flow
                          </button>
                        )}
                        {(['Drill 1 · 10x Bottleneck', 'Drill 2 · Outage Failover', 'Drill 3 · CAP Trade-off'] as const).map(
                          (label, idx) => (
                            <button
                              key={label}
                              type="button"
                              className="decision-chip"
                              onClick={() => handleSelectDrill(idx)}
                            >
                              {label}
                            </button>
                          ),
                        )}
                      </>
                    ) : stage === 'scope' ? (
                      <>
                        <button
                          type="button"
                          className={`decision-chip ${
                            extractedSignals.latencySla === latencyTargetChip ? 'locked' : ''
                          }`}
                          onClick={() => handleCommitScopeSignal('latencySla', latencyTargetChip)}
                        >
                          SLA: {latencyTargetChip}
                        </button>
                        <button
                          type="button"
                          className={`decision-chip ${
                            extractedSignals.consistencyModel === preferredCapChip ? 'locked' : ''
                          }`}
                          onClick={() => handleCommitScopeSignal('consistencyModel', preferredCapChip)}
                        >
                          {preferredCapChip === 'CP' ? 'Strict CP' : 'AP · Eventual'}
                        </button>
                        <button
                          type="button"
                          className={`decision-chip ${
                            extractedSignals.consistencyModel === altCapChip ? 'locked' : ''
                          }`}
                          onClick={() => handleCommitScopeSignal('consistencyModel', altCapChip)}
                        >
                          {altCapChip === 'CP' ? 'Strict CP' : 'AP · Eventual'}
                        </button>
                        <button
                          type="button"
                          className={`decision-chip ${
                            extractedSignals.scaleTarget === '50k peak QPS' ? 'locked' : ''
                          }`}
                          onClick={() => handleCommitScopeSignal('scaleTarget', '50k peak QPS')}
                        >
                          50k peak QPS
                        </button>
                        <button
                          type="button"
                          className="decision-chip advance"
                          onClick={() => handleSelectStage('contracts')}
                        >
                          <span>Lock Scope &amp; API</span>
                          <IconArrowRight size={12} />
                        </button>
                      </>
                    ) : stage === 'contracts' ? (
                      <>
                        {(['REST + JSON', 'WebSocket / SSE', 'gRPC'] as const).map((proto) => (
                          <button
                            key={proto}
                            type="button"
                            className={`decision-chip ${
                              extractedSignals.wireProtocol === proto ? 'locked' : ''
                            }`}
                            onClick={() => handleToggleContractTag(proto, true)}
                          >
                            {proto}
                          </button>
                        ))}
                        {(['Idempotency-Key', 'Cursor Pagination', 'Presigned URL'] as const).map(
                          (tag) => (
                            <button
                              key={tag}
                              type="button"
                              className={`decision-chip ${
                                contractTags.includes(tag) ? 'locked' : ''
                              }`}
                              onClick={() => handleToggleContractTag(tag, false)}
                            >
                              {tag}
                            </button>
                          ),
                        )}
                        <button
                          type="button"
                          className="decision-chip advance"
                          onClick={() => {
                            if (graph.nodes.length === 0) handleSeedStarterFlow();
                            else handleSelectStage('topology');
                          }}
                        >
                          <span>{graph.nodes.length === 0 ? 'Seed Starter Flow' : 'Go to Board'}</span>
                          <IconArrowRight size={12} />
                        </button>
                      </>
                    ) : stage === 'topology' ? (
                      <>
                        {graph.nodes.length === 0 && (
                          <button
                            type="button"
                            className="decision-chip locked"
                            onClick={handleSeedStarterFlow}
                          >
                            + Seed Starter Flow
                          </button>
                        )}
                        {missingBoardKinds.slice(0, 4).map((kind) => {
                          const preset = STENCIL_PRESETS.find((p) => p.kind === kind);
                          if (!preset) return null;
                          return (
                            <button
                              key={kind}
                              type="button"
                              className="decision-chip"
                              onClick={() => handleStampStencil(kind)}
                            >
                              + {preset.label}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="decision-chip advance"
                          onClick={() => handleSelectStage('hardening')}
                        >
                          <span>Stress-Test</span>
                          <IconArrowRight size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        {['Drill 1 · Concurrency / Skew', 'Drill 2 · Failover', 'Drill 3 · 10x Surge'].map(
                          (label, idx) => (
                            <button
                              key={label}
                              type="button"
                              className={`decision-chip ${activeDrillIdx === idx ? 'locked' : ''}`}
                              onClick={() => handleSelectDrill(idx)}
                            >
                              {label}
                            </button>
                          ),
                        )}
                      </>
                    )}
                  </div>
                </section>

                {/* Single Actionable Red-Flag Alert */}
                {warnFinding && (
                  <button
                    type="button"
                    className="finding-card warn"
                    onClick={() => focusCanvasNodes(warnFinding.nodeIds)}
                  >
                    <div className="finding-title">Red Flag · {warnFinding.title}</div>
                    <div className="finding-detail">{warnFinding.detail}</div>
                  </button>
                )}

                {/* Locked Commitments Strip */}
                {(Object.values(extractedSignals).some(Boolean) || contractTags.length > 0) && (
                  <div className="commitments-strip" aria-label="Locked interview commitments">
                    {extractedSignals.latencySla && (
                      <span className="tag-pill committed">SLA: {extractedSignals.latencySla}</span>
                    )}
                    {extractedSignals.consistencyModel && (
                      <span className="tag-pill committed">CAP: {extractedSignals.consistencyModel}</span>
                    )}
                    {extractedSignals.scaleTarget && (
                      <span className="tag-pill committed">Scale: {extractedSignals.scaleTarget}</span>
                    )}
                    {extractedSignals.wireProtocol && (
                      <span className="tag-pill committed">Wire: {extractedSignals.wireProtocol}</span>
                    )}
                    {extractedSignals.primaryStorage && (
                      <span className="tag-pill committed">Store: {extractedSignals.primaryStorage}</span>
                    )}
                    {contractTags.map((t) => (
                      <span key={t} className="tag-pill committed">
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {needleStatus.matchedPlaybookId && (
                  <button
                    type="button"
                    className="finding-card info"
                    onClick={() => {
                      setPlaybookFilter('all');
                      setRailTab('playbook');
                    }}
                  >
                    <div className="finding-title">
                      Playbook Match:{' '}
                      {INTERVIEW_PLAYBOOK.find((c) => c.id === needleStatus.matchedPlaybookId)?.title}
                    </div>
                    <div className="finding-detail">Open tactical reference</div>
                  </button>
                )}

                {/* Live Board Checkpoints (Archetype Mode) */}
                {!isFreeFlow && checkStates.length > 0 && (
                  <div className="scorecard-block">
                    <div className="scorecard-head">
                      <span className="spec-heading">Live Board Checkpoints</span>
                      <span className="scorecard-count">
                        {checkedCount}/{checkStates.length}
                      </span>
                    </div>
                    <div className="compact-checks">
                      {checkStates.map((chk) => (
                        <button
                          key={chk.id}
                          type="button"
                          className={`compact-check-row ${chk.checked ? 'done' : ''}`}
                          onClick={() =>
                            setManualChecks((prev) => ({ ...prev, [chk.id]: !prev[chk.id] }))
                          }
                          title={chk.hint}
                        >
                          <span className={`check-box ${chk.checked ? 'checked' : ''}`}>
                            {chk.checked && <IconCheck size={11} />}
                          </span>
                          <span className="compact-check-label">{chk.label}</span>
                          {chk.auto && <span className="auto-badge">ON BOARD</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Compact 2x2 Interview Signal Grid */}
                <div className="scorecard-block">
                  <div className="scorecard-head">
                    <span className="spec-heading">Interview Signal</span>
                  </div>
                  <div className="signal-grid">
                    {rubricScores.map((axis) => (
                      <div key={axis.id} className="signal-cell">
                        <div className="signal-cell-top">
                          <span>{axis.label}</span>
                          <span className="signal-pct">{axis.score}%</span>
                        </div>
                        <div className="rubric-track">
                          <div className="rubric-fill" style={{ width: `${axis.score}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Collapsible Session Log */}
                {messages.length > 1 && (
                  <div className="history-drawer">
                    <button
                      type="button"
                      className="history-toggle"
                      onClick={() => setShowHistory((s) => !s)}
                      aria-expanded={showHistory}
                    >
                      <span>Session Log ({messages.length})</span>
                      <IconChevronDown
                        size={12}
                        className={`studio-dropdown-chevron ${showHistory ? 'open' : ''}`}
                      />
                    </button>
                    {showHistory && (
                      <div className="msg-list">
                        {messages.slice(-8).map((m) => (
                          <article key={m.id} className={`msg-card ${m.role}`}>
                            <div className="msg-meta">
                              <span>
                                {m.role === 'coach'
                                  ? m.engineLabel ?? 'Interviewer'
                                  : m.source === 'voice'
                                    ? 'You · Voice'
                                    : 'You'}
                              </span>
                              <span>{m.stage.toUpperCase()}</span>
                            </div>
                            <div className="msg-text">{m.text}</div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form className="composer-form" onSubmit={handleFormSubmit}>
                <input
                  type="text"
                  id="coach-input"
                  className="composer-input"
                  placeholder='Answer in 1 sentence or run "Add Redis Cache"…'
                  aria-label="Message the architecture coach"
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                />
                <button
                  type="submit"
                  id="coach-send-btn"
                  className="pill-btn primary"
                  disabled={busyCoach || !draftInput.trim()}
                  aria-label="Send message"
                >
                  <IconSend size={14} />
                </button>
              </form>
            </>
          ) : railTab === 'solution' && activeSolution ? (
            <div className="rail-body">
              <div className="spec-section">
                <div className="spec-heading">Principal Reference Blueprint</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-primary)' }}>
                  {activeSolution.headline}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <span className="tag-pill">{activeSolution.nodes.length} components</span>
                  <span className="tag-pill">{activeSolution.edges.length} data/control flows</span>
                  <span className="tag-pill">{activeSolution.planes.length} planes</span>
                </div>
                <button
                  type="button"
                  id="stamp-solution-btn"
                  className="pill-btn primary"
                  style={{ alignSelf: 'flex-start', marginTop: 6 }}
                  onClick={handleStampReferenceSolution}
                >
                  <span>Stamp Full Blueprint on Canvas</span>
                  <IconArrowRight size={13} />
                </button>
              </div>

              <div className="spec-section">
                <div className="spec-heading">Capacity &amp; Sizing Math</div>
                <ul className="spec-list">
                  {activeSolution.capacityMath.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>

              <div className="spec-section">
                <div className="spec-heading">Schema, Keys &amp; Invariants</div>
                {activeSolution.schemaAndKeys.map((line, i) => (
                  <div key={i} className="code-line">
                    {line}
                  </div>
                ))}
              </div>

              <div className="spec-section">
                <div className="spec-heading">Write Path Lifecycle</div>
                <div style={{ fontSize: '12px', color: 'var(--fg-primary)', lineHeight: 1.48 }}>
                  {activeSolution.writePath}
                </div>
              </div>

              <div className="spec-section">
                <div className="spec-heading">Read Path Lifecycle</div>
                <div style={{ fontSize: '12px', color: 'var(--fg-primary)', lineHeight: 1.48 }}>
                  {activeSolution.readPath}
                </div>
              </div>

              <div className="spec-section">
                <div className="spec-heading">Storage &amp; Partitioning</div>
                <ul className="spec-list">
                  {activeSolution.storageNotes.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>

              <div className="spec-section">
                <div className="spec-heading">Staff+ Failure &amp; Scale Defenses</div>
                <ul className="spec-list">
                  {activeSolution.staffTradeoffs.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : railTab === 'brief' ? (
            <div className="rail-body">
              <div className="spec-section">
                <div className="spec-heading">Problem Statement</div>
                <div style={{ fontSize: '12.5px', color: 'var(--fg-primary)' }}>
                  {challenge.summary}
                </div>
              </div>

              <div className="spec-section">
                <div className="spec-heading">Core Capabilities (In Scope)</div>
                <ul className="spec-list">
                  {challenge.functionalGoals.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
                {challenge.outOfScope.length > 0 && (
                  <div className="rubric-note">
                    Out of scope: {challenge.outOfScope.join(' · ')}
                  </div>
                )}
              </div>

              <div className="spec-section">
                <div className="spec-heading">Target SLAs</div>
                <ul className="spec-list">
                  {challenge.slaTargets.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>

              <div className="spec-section">
                <div className="spec-heading">Entities &amp; API Sketch</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                  {challenge.coreEntities.map((ent) => (
                    <span key={ent} className="tag-pill">
                      {ent}
                    </span>
                  ))}
                </div>
                {challenge.apiSketch.map((line, i) => (
                  <div key={i} className="code-line">
                    {line}
                  </div>
                ))}
              </div>

              <div className="spec-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="spec-heading">Inline Sizing Math</span>
                  <button
                    type="button"
                    className="stencil-chip"
                    onClick={() => setShowMathHint((s) => !s)}
                  >
                    {showMathHint ? 'Hide' : 'Reveal'}
                  </button>
                </div>
                {showMathHint ? (
                  <div className="code-line">{challenge.inlineMathPrompt}</div>
                ) : (
                  <div className="rubric-note">
                    Compute inline only when sizing a cache, shard count, or bandwidth ceiling.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rail-body">
              <div className="prompt-chips" role="group" aria-label="Filter interview playbook">
                {(
                  [
                    ['all', 'All'],
                    ['tactics', 'Pacing & Tricks'],
                    ['numbers', 'Numbers'],
                    ['patterns', 'Patterns'],
                    ['traps', 'Red Flags'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="prompt-chip"
                    style={
                      playbookFilter === key
                        ? {
                            borderColor: 'var(--fg-primary)',
                            color: 'var(--fg-primary)',
                            fontWeight: 600,
                          }
                        : undefined
                    }
                    onClick={() => setPlaybookFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {INTERVIEW_PLAYBOOK.filter(
                (card) => playbookFilter === 'all' || card.category === playbookFilter,
              ).map((card) => (
                <div key={card.id} className="spec-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 12.5 }}>{card.title}</span>
                    <span className="tag-pill">{card.category.toUpperCase()}</span>
                  </div>
                  <div className="rubric-note">{card.summary}</div>
                  <ul className="spec-list">
                    {card.bullets.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </aside>
      </main>

      {/* Responsive Mobile Switcher (< 860px) */}
      <nav className="mobile-nav" aria-label="Mobile workspace view switcher">
        <button
          type="button"
          className={`mobile-nav-btn ${mobilePane === 'canvas' ? 'active' : ''}`}
          onClick={() => setMobilePane('canvas')}
        >
          Board ({graph.nodes.length})
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${mobilePane === 'coach' ? 'active' : ''}`}
          onClick={() => {
            setRailCollapsed(false);
            setRailTab('coach');
            setMobilePane('coach');
          }}
        >
          Interview
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${mobilePane === 'brief' ? 'active' : ''}`}
          onClick={() => {
            setRailCollapsed(false);
            setRailTab(isFreeFlow ? 'playbook' : 'solution');
            setMobilePane('brief');
          }}
        >
          {isFreeFlow ? 'Playbook' : 'Solution'}
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${mobilePane === 'playbook' ? 'active' : ''}`}
          onClick={() => {
            setRailCollapsed(false);
            setRailTab('playbook');
            setMobilePane('playbook');
          }}
        >
          Guide
        </button>
      </nav>
    </div>
  );
}
