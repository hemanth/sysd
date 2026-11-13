import type { ComponentKind, StageSpec } from '../types';

export const DESIGN_STAGES: StageSpec[] = [
  {
    id: 'scope',
    index: 1,
    label: '1. Scope & SLAs',
    shortLabel: 'Scope',
    targetMinutes: 5,
    headline: 'Pin down 3 core capabilities and measurable SLAs.',
    guidance:
      'State the top 3 user actions, explicitly cut non-essential scope, and attach concrete numbers to latency, scale, or consistency vs. availability.',
    antiPattern:
      'Avoid vague phrases like "should be fast" or spending 10 minutes on upfront capacity arithmetic that does not change an architectural choice.',
    prompts: [
      'Which 3 user or system capabilities matter most, and what are you scoping out?',
      'Where does this workload sit on Consistency vs. Availability, and what is the read:write ratio?',
      'What concrete p99 latency target defines success on the critical path?',
    ],
  },
  {
    id: 'contracts',
    index: 2,
    label: '2. Domain & API',
    shortLabel: 'Contracts',
    targetMinutes: 5,
    headline: 'Name the core nouns and map one clean API per capability.',
    guidance:
      'List the core domain entities without premature column-by-column schema bikeshedding. Choose protocol (REST, WebSocket/SSE, or gRPC) and sketch request/response contracts.',
    antiPattern:
      'Do not design 15 database columns before you know your read/write access patterns on the canvas.',
    prompts: [
      'What are the 3-4 core domain entities persisted or exchanged?',
      'Which protocol fits best (REST, persistent WebSockets, SSE, or gRPC) and why?',
      'How do pagination, idempotency keys, or auth tokens appear on your primary endpoints?',
    ],
  },
  {
    id: 'topology',
    index: 3,
    label: '3. Baseline Topology',
    shortLabel: 'Topology',
    targetMinutes: 12,
    headline: 'Trace every endpoint end-to-end on the canvas.',
    guidance:
      'Draw the cleanest end-to-end read and write paths first. Jot key fields next to data stores, label arrows with protocols or payloads, and flag bottlenecks to revisit rather than stalling.',
    antiPattern:
      'Getting pulled into an 8-minute sharding rabbit hole before half your endpoints even have a working path.',
    prompts: [
      'Walk me through the primary write path from client to durable storage.',
      'Now trace the primary read path—what data store or index serves it?',
      'Would someone opening this board tomorrow understand the flow without narration?',
    ],
  },
  {
    id: 'hardening',
    index: 4,
    label: '4. Scale & Failure',
    shortLabel: 'Deep Dive',
    targetMinutes: 13,
    headline: 'Stress-test bottlenecks against your SLAs with inline math.',
    guidance:
      'Walk down your SLA list and harden weak spots: hot partitions, cache invalidation, async backpressure, failover, and targeted capacity math right next to the affected component.',
    antiPattern:
      'Monologuing non-stop without checking whether the interviewer wants to probe consistency, tail latency, or failure recovery.',
    prompts: [
      'What is the single sharpest bottleneck at 10x peak load, and what number proves it?',
      'What happens when your cache, queue consumer, or primary shard fails mid-request?',
      'Which trade-off did you make consciously, and when would that choice break?',
    ],
  },
];

export interface StencilPreset {
  kind: ComponentKind;
  label: string;
  defaultTitle: string;
  shape: 'rectangle' | 'ellipse' | 'diamond';
  strokeColor: string;
  backgroundColor: string;
  darkStrokeColor: string;
  darkBackgroundColor: string;
}

export const STENCIL_PRESETS: StencilPreset[] = [
  {
    kind: 'client',
    label: 'Client',
    defaultTitle: 'Web / Mobile Client',
    shape: 'rectangle',
    strokeColor: '#1f2328',
    backgroundColor: '#f6f5f1',
    darkStrokeColor: '#e6e8eb',
    darkBackgroundColor: '#1f2329',
  },
  {
    kind: 'cdn',
    label: 'CDN / Edge',
    defaultTitle: 'Edge CDN',
    shape: 'ellipse',
    strokeColor: '#334155',
    backgroundColor: '#eef2f6',
    darkStrokeColor: '#cbd5e1',
    darkBackgroundColor: '#1e293b',
  },
  {
    kind: 'gateway',
    label: 'Gateway / LB',
    defaultTitle: 'API Gateway / LB',
    shape: 'diamond',
    strokeColor: '#1f2328',
    backgroundColor: '#f1efe9',
    darkStrokeColor: '#e2e8f0',
    darkBackgroundColor: '#262930',
  },
  {
    kind: 'service',
    label: 'Service',
    defaultTitle: 'Core Service',
    shape: 'rectangle',
    strokeColor: '#0f172a',
    backgroundColor: '#ffffff',
    darkStrokeColor: '#f1f5f9',
    darkBackgroundColor: '#181b20',
  },
  {
    kind: 'cache',
    label: 'Cache',
    defaultTitle: 'Redis Cache',
    shape: 'rectangle',
    strokeColor: '#0f5132',
    backgroundColor: '#edf7f1',
    darkStrokeColor: '#6ee7b7',
    darkBackgroundColor: '#132a22',
  },
  {
    kind: 'queue',
    label: 'Queue / Log',
    defaultTitle: 'Event Stream / Queue',
    shape: 'rectangle',
    strokeColor: '#7c2d12',
    backgroundColor: '#fdf3eb',
    darkStrokeColor: '#fdba74',
    darkBackgroundColor: '#2c1c12',
  },
  {
    kind: 'database',
    label: 'Database',
    defaultTitle: 'Primary DB',
    shape: 'rectangle',
    strokeColor: '#1e3a5f',
    backgroundColor: '#edf3fa',
    darkStrokeColor: '#93c5fd',
    darkBackgroundColor: '#162436',
  },
  {
    kind: 'blob',
    label: 'Object Store',
    defaultTitle: 'Blob Object Store',
    shape: 'ellipse',
    strokeColor: '#3f3f46',
    backgroundColor: '#f4f4f5',
    darkStrokeColor: '#d4d4d8',
    darkBackgroundColor: '#27272a',
  },
  {
    kind: 'worker',
    label: 'Worker',
    defaultTitle: 'Async Worker Pool',
    shape: 'rectangle',
    strokeColor: '#374151',
    backgroundColor: '#f3f4f6',
    darkStrokeColor: '#d1d5db',
    darkBackgroundColor: '#1f242d',
  },
  {
    kind: 'search',
    label: 'Search Index',
    defaultTitle: 'Inverted Search Index',
    shape: 'rectangle',
    strokeColor: '#3f3f46',
    backgroundColor: '#f5f5f4',
    darkStrokeColor: '#d6d3d1',
    darkBackgroundColor: '#242322',
  },
];

export const TOTAL_MOCK_MINUTES = DESIGN_STAGES.reduce((sum, s) => sum + s.targetMinutes, 0);
