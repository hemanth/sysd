import { CHALLENGES } from '../data/challenges';
import { ARCHETYPE_SOLUTIONS } from '../data/solutions';
import type { TopologyGraph } from '../types';

export interface SysdWebMcpBridge {
  openChallenge: (challengeId: string, customTopic?: string) => void;
  stampSolution: (challengeId?: string) => TopologyGraph | null;
  getGraph: () => TopologyGraph;
}

let registered = false;
let latestBridge: SysdWebMcpBridge | null = null;

export function registerSysdWebMcpTools(bridge: SysdWebMcpBridge): void {
  latestBridge = bridge;
  if (registered || typeof navigator === 'undefined') return;

  const nav = navigator as unknown as {
    modelContext?: {
      registerTool?: (spec: Record<string, unknown>) => void;
    };
  };

  if (!nav.modelContext || typeof nav.modelContext.registerTool !== 'function') {
    return;
  }

  registered = true;

  try {
    nav.modelContext.registerTool({
      name: 'list_sysd_archetypes',
      description:
        'List all 11 canonical distributed systems challenges and Free-Flow practice mode in sysd, including SLA targets, entities, and API contracts.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['all', 'product', 'infra'],
            description: 'Optional category filter.',
          },
        },
      },
      handler: async (args?: { category?: string }) => {
        const cat = args?.category && args.category !== 'all' ? args.category : null;
        const items = CHALLENGES.filter((c) => !cat || c.category === cat).map((c) => ({
          id: c.id,
          title: c.title,
          category: c.category,
          difficulty: c.difficulty,
          slaTargets: c.slaTargets,
          coreEntities: c.coreEntities,
          apiSketch: c.apiSketch,
        }));
        return {
          freeFlowId: 'free-flow',
          count: items.length,
          archetypes: items,
        };
      },
    });

    nav.modelContext.registerTool({
      name: 'get_sysd_reference_solution',
      description:
        'Retrieve the Staff-level reference architecture solution (write path, read path, storage partitioning, failure defenses, and graph nodes/edges) for a sysd archetype.',
      parameters: {
        type: 'object',
        properties: {
          challengeId: {
            type: 'string',
            enum: CHALLENGES.map((c) => c.id),
            description: 'Archetype ID such as seat-ticketing, social-timeline, or cloud-file-sync.',
          },
        },
        required: ['challengeId'],
      },
      handler: async ({ challengeId }: { challengeId: string }) => {
        const sol = ARCHETYPE_SOLUTIONS[challengeId];
        if (!sol) {
          return { error: `Unknown challengeId: ${challengeId}` };
        }
        return sol;
      },
    });

    nav.modelContext.registerTool({
      name: 'stamp_sysd_topology',
      description:
        'Open a challenge or Free-Flow session on the live sysd Excalidraw canvas, optionally stamp its Staff reference topology, and return the parsed scene-graph diagnostics.',
      parameters: {
        type: 'object',
        properties: {
          challengeId: {
            type: 'string',
            description: 'Archetype ID or "free-flow".',
          },
          customTopic: {
            type: 'string',
            description: 'Optional custom topic when challengeId is "free-flow".',
          },
          stampReference: {
            type: 'boolean',
            description: 'If true, stamps the reference architecture blueprint onto the canvas.',
          },
        },
        required: ['challengeId'],
      },
      handler: async ({
        challengeId,
        customTopic,
        stampReference,
      }: {
        challengeId: string;
        customTopic?: string;
        stampReference?: boolean;
      }) => {
        if (!latestBridge) return { error: 'sysd bridge not mounted' };
        latestBridge.openChallenge(challengeId, customTopic);
        await new Promise((r) => setTimeout(r, 120));
        const graph = stampReference
          ? latestBridge.stampSolution(challengeId) ?? latestBridge.getGraph()
          : latestBridge.getGraph();
        return {
          challengeId,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          findings: graph.findings,
        };
      },
    });
  } catch {
    // Non-fatal if browser WebMCP spec differs
  }
}
