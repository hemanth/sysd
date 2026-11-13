export type StageId = 'scope' | 'contracts' | 'topology' | 'hardening';

export type PracticeMode = 'guided' | 'mock';

export type CandidateLevel = 'mid' | 'senior' | 'staff';

export type MobilePane = 'canvas' | 'coach' | 'brief' | 'playbook';

export type ChallengeCategory = 'product' | 'infrastructure';

export type ComponentKind =
  | 'client'
  | 'cdn'
  | 'gateway'
  | 'service'
  | 'cache'
  | 'queue'
  | 'database'
  | 'blob'
  | 'worker'
  | 'search';

export interface StageSpec {
  id: StageId;
  index: number;
  label: string;
  shortLabel: string;
  targetMinutes: number;
  headline: string;
  guidance: string;
  antiPattern: string;
  prompts: string[];
}

export interface ChallengeCheck {
  id: string;
  stage: StageId;
  label: string;
  hint: string;
  requiredKinds?: ComponentKind[];
  requiredKeywords?: string[];
  requireEdge?: [ComponentKind, ComponentKind];
}

export interface ChallengeSpec {
  id: string;
  title: string;
  subtitle: string;
  category: ChallengeCategory;
  difficulty: 'Core' | 'Intermediate' | 'Staff';
  summary: string;
  functionalGoals: string[];
  outOfScope: string[];
  slaTargets: string[];
  coreEntities: string[];
  apiSketch: string[];
  dataFlowSteps?: string[];
  inlineMathPrompt: string;
  deepDiveProbes: string[];
  expectedKinds: ComponentKind[];
  forbidDirectClientDb?: boolean;
  requiresAsyncQueue?: boolean;
  requiresBlobOffload?: boolean;
  requiresReadCache?: boolean;
  checks: ChallengeCheck[];
}

export interface ArchNode {
  id: string;
  label: string;
  kind: ComponentKind;
  x: number;
  y: number;
  width: number;
  height: number;
  notes?: string;
}

export interface ArchEdge {
  id: string;
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  fromKind: ComponentKind;
  toKind: ComponentKind;
  label: string;
}

export interface TopologyFinding {
  id: string;
  severity: 'warn' | 'info' | 'good';
  title: string;
  detail: string;
  nodeIds?: string[];
}

export interface TopologyGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  freeNotes: string[];
  orphans: ArchNode[];
  singlePoints: ArchNode[];
  findings: TopologyFinding[];
  fingerprint: string;
}

export interface RubricAxisScore {
  id: 'prioritization' | 'coherence' | 'depth' | 'clarity';
  label: string;
  score: number; // 0..100
  note: string;
}

export interface CoachMessage {
  id: string;
  role: 'coach' | 'candidate' | 'system';
  text: string;
  timestamp: number;
  stage: StageId;
  source?: 'voice' | 'text' | 'board';
  engineLabel?: string;
  streaming?: boolean;
  relatedNodeIds?: string[];
}

export type LlmBackendKind = 'builtin-ai' | 'webllm' | 'heuristic';

export interface LlmStatus {
  backend: LlmBackendKind;
  modelId: string;
  ready: boolean;
  loading: boolean;
  progress: number;
  progressText: string;
  webgpuSupported: boolean;
  builtinSupported: boolean;
  error?: string;
}

export type VoiceTurnState = 'off' | 'loading' | 'listening' | 'speaking-user' | 'transcribing' | 'speaking-coach';

export type SttEngineChoice = 'whistle' | 'whisper';

export interface VoiceStatus {
  state: VoiceTurnState;
  vadBackend: string;
  sttChoice: SttEngineChoice;
  sttBackend: string;
  sttReady: boolean;
  sttLoading: boolean;
  sttProgress: number;
  lastTtftMs?: number;
  lastTps?: number;
  ttsEnabled: boolean;
  level: number;
  probability: number;
  interimTranscript: string;
  error?: string;
}

export interface ExtractedDesignSignals {
  latencySla?: string;
  scaleTarget?: string;
  consistencyModel?: 'CP' | 'AP';
  wireProtocol?: string;
  primaryStorage?: string;
}

export interface NeedleStatus {
  enabled: boolean;
  ready: boolean;
  loading: boolean;
  progress: number;
  lastConfidence?: number | null;
  lastActionSummary?: string;
  matchedPlaybookId?: string;
  error?: string;
}
