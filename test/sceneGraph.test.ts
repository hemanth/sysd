import { describe, expect, it } from 'vitest';
import { CHALLENGES } from '../src/data/challenges';
import { INTERVIEW_PLAYBOOK } from '../src/data/playbook';
import {
  ARCHETYPE_SOLUTIONS,
  buildSolutionExcalidrawSkeletons,
} from '../src/data/solutions';
import {
  buildWhistleKeywords,
  extractRegexFallbackSignals,
  looksLikeCanvasCommand,
  sanitizePcm16k,
} from '../src/lib/cactusRuntime';
import { generateHeuristicCoachReply } from '../src/lib/onDeviceLlm';
import {
  buildArrowSkeletonBetweenNodes,
  classifyComponentKind,
  extractTopology,
  scoreRubric,
  serializeTopologyForLlm,
  type RawExcalidrawElement,
} from '../src/lib/sceneGraph';

describe('Architecture Scene Graph & Interview Engine', () => {
  it('classifies diverse real-world component labels accurately', () => {
    expect(classifyComponentKind('Mobile iOS Client')).toBe('client');
    expect(classifyComponentKind('Cloudflare Edge CDN')).toBe('cdn');
    expect(classifyComponentKind('Envoy API Gateway')).toBe('gateway');
    expect(classifyComponentKind('Redis Sorted Set')).toBe('cache');
    expect(classifyComponentKind('Kafka Event Log')).toBe('queue');
    expect(classifyComponentKind('Postgres Primary DB')).toBe('database');
    expect(classifyComponentKind('S3 Presigned Blob Store')).toBe('blob');
    expect(classifyComponentKind('Firecracker Sandbox Worker')).toBe('worker');
    expect(classifyComponentKind('OpenSearch Inverted Index')).toBe('search');
  });

  it('flags direct Client -> Database anti-pattern and detects bound text + arrows', () => {
    const ticketing = CHALLENGES.find((c) => c.id === 'seat-ticketing')!;
    const elements: RawExcalidrawElement[] = [
      { id: 'c1', type: 'rectangle', x: 50, y: 100, width: 150, height: 70 },
      { id: 't1', type: 'text', x: 60, y: 120, text: 'Web Client', containerId: 'c1' },
      { id: 'd1', type: 'rectangle', x: 350, y: 100, width: 160, height: 70 },
      { id: 't2', type: 'text', x: 360, y: 120, text: 'Postgres DB', containerId: 'd1' },
      {
        id: 'a1',
        type: 'arrow',
        x: 200,
        y: 135,
        points: [
          [0, 0],
          [150, 0],
        ],
        startBinding: { elementId: 'c1' },
        endBinding: { elementId: 'd1' },
      },
    ];

    const graph = extractTopology(elements, ticketing);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.findings.some((f) => f.id === 'direct-client-db' && f.severity === 'warn')).toBe(
      true,
    );

    const coach = generateHeuristicCoachReply(ticketing, 'topology', graph, '', 0);
    expect(coach.text).toMatch(/Client connected directly to Database/i);
  });

  it('recognizes clean presigned Client <-> Object Store offload and inline sizing math', () => {
    const fileSync = CHALLENGES.find((c) => c.id === 'cloud-file-sync')!;
    const elements: RawExcalidrawElement[] = [
      { id: 'n_client', type: 'rectangle', x: 40, y: 80, width: 150, height: 70, customData: { kind: 'client' } },
      { id: 'tc', type: 'text', x: 50, y: 95, text: 'Desktop Client', containerId: 'n_client' },
      { id: 'n_s3', type: 'ellipse', x: 340, y: 80, width: 160, height: 70, customData: { kind: 'blob' } },
      { id: 'ts', type: 'text', x: 350, y: 95, text: 'S3 Chunk Store', containerId: 'n_s3' },
      { id: 'note_math', type: 'text', x: 345, y: 165, text: '4 MB SHA-256 chunks, 160 GB hot cache' },
      {
        id: 'arr_put',
        type: 'arrow',
        x: 190,
        y: 115,
        points: [
          [0, 0],
          [150, 0],
        ],
        startBinding: { elementId: 'n_client' },
        endBinding: { elementId: 'n_s3' },
      },
      { id: 'ta', type: 'text', x: 230, y: 105, text: 'Presigned PUT', containerId: 'arr_put' },
    ];

    const graph = extractTopology(elements, fileSync);
    expect(graph.findings.some((f) => f.id === 'presigned-offload-good')).toBe(true);
    expect(graph.findings.some((f) => f.id === 'inline-annotations-good')).toBe(true);

    const summary = serializeTopologyForLlm(graph, 'hardening');
    expect(summary).toContain('Presigned PUT');

    const rubric = scoreRubric(graph, fileSync, 2, 2, 3);
    expect(rubric).toHaveLength(4);
    expect(rubric.every((r) => r.score > 0 && r.score <= 100)).toBe(true);
  });

  it('ships all 11 canonical system design challenges, reference solutions, and complete interview playbook', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(11);
    for (const ch of CHALLENGES) {
      expect(ch.functionalGoals.length).toBeGreaterThanOrEqual(2);
      expect(ch.slaTargets.length).toBeGreaterThanOrEqual(3);
      expect(ch.deepDiveProbes.length).toBeGreaterThanOrEqual(3);
      expect(ch.checks.length).toBeGreaterThanOrEqual(3);

      const sol = ARCHETYPE_SOLUTIONS[ch.id];
      expect(sol).toBeDefined();
      expect(sol.nodes.length).toBeGreaterThanOrEqual(9);
      expect(sol.edges.length).toBeGreaterThanOrEqual(8);
      expect(sol.capacityMath.length).toBeGreaterThanOrEqual(3);
      expect(sol.schemaAndKeys.length).toBeGreaterThanOrEqual(3);
      const skeletons = buildSolutionExcalidrawSkeletons(sol, false);
      expect(skeletons.length).toBeGreaterThan(sol.nodes.length + sol.edges.length);
    }
    expect(INTERVIEW_PLAYBOOK.length).toBeGreaterThanOrEqual(9);
  });

  it('builds Cactus Whistle keyword bias lists, clamps PCM safely, and extracts SLA signals', () => {
    const timeline = CHALLENGES.find((c) => c.id === 'social-timeline')!;
    const graph = extractTopology(
      [
        { id: 'box1', type: 'rectangle', x: 0, y: 0, width: 140, height: 60 },
        { id: 'txt1', type: 'text', x: 10, y: 10, text: 'TimelineInboxCache', containerId: 'box1' },
      ],
      timeline,
    );
    const kw = buildWhistleKeywords(timeline, graph);
    expect(kw).toContain('Redis');
    expect(kw).toContain('FollowEdge');
    expect(kw).toContain('TimelineInboxCache');

    const hotPcm = new Float32Array([-1.4, -0.5, 0, 0.75, 1.35, Number.NaN]);
    const clean = sanitizePcm16k(hotPcm);
    expect(Array.from(clean)).toEqual([-1, -0.5, 0, 0.75, 1, 0]);

    expect(looksLikeCanvasCommand('Add a Redis cache and connect Core Service to Redis')).toBe(true);
    expect(looksLikeCanvasCommand('Our feed read latency SLA is under 180ms p99')).toBe(false);

    const signals = extractRegexFallbackSignals(
      'Feed loads in < 180ms p99 for 80M DAU, AP eventual consistency over REST backed by DynamoDB',
    );
    expect(signals.latencySla).toContain('180ms');
    expect(signals.scaleTarget).toContain('80M DAU');
    expect(signals.consistencyModel).toBe('AP');
    expect(signals.wireProtocol).toBe('REST');
    expect(signals.primaryStorage).toBe('DynamoDB');

    const arrow = buildArrowSkeletonBetweenNodes(
      { id: 'a', label: 'GW', kind: 'gateway', x: 100, y: 100, width: 150, height: 70 },
      { id: 'b', label: 'Svc', kind: 'service', x: 350, y: 100, width: 150, height: 70 },
      false,
      'gRPC',
    );
    expect(arrow[0].label?.text).toBe('gRPC');
  });
});
