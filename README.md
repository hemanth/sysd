# sysd

Sketch distributed systems topologies on Excalidraw and defend trade-offs with live scene-graph diagnostics, Staff-level reference blueprints, and local WASM/WebGPU voice + tool-calling models.

```bash
git clone https://github.com/hemanth/sysd.git
cd sysd
npm install
npm run dev
```

## Quick start

```ts
import { extractTopology, scoreRubric } from './src/lib/sceneGraph';
import { CHALLENGES } from './src/data/challenges';
import { ARCHETYPE_SOLUTIONS, buildSolutionExcalidrawSkeletons } from './src/data/solutions';

const challenge = CHALLENGES.find((c) => c.id === 'seat-ticketing')!;
const skeletons = buildSolutionExcalidrawSkeletons(ARCHETYPE_SOLUTIONS[challenge.id]);
const graph = extractTopology(skeletons as any, challenge);
const scores = scoreRubric(graph, challenge, 3, 4, 4);
```

`extractTopology()` classifies drawn Excalidraw shapes, bound labels, arrows, and inline capacity notes into a typed `TopologyGraph` and flags anti-patterns (`Client -> DB`, missing presigned offload, disconnected stores). `scoreRubric()` scores prioritization, end-to-end coherence, storage/failure depth, and clarity.

## On-device WASM & WebGPU stack

```ts
import { CactusNeedleController, CactusWhistleTranscriber } from './src/lib/cactusRuntime';
import { VoicePipelineController } from './src/lib/voicePipeline';

const needle = new CactusNeedleController();
await needle.enable(); // 35.3 MB WASM: tool-calling + SLA/CAP extraction + 3072-d embeddings

const actions = await needle.inferCanvasActions('Add Redis Cache and wire Core Service to Redis');
```

All models preload opaquely in Web Workers with zero runtime configuration UI:

- `cactus-needle` (`Needle 3`, 35.3 MB WASM) runs grammar-constrained canvas tool calls (`add_component`, `connect_components`, `set_stage`, `select_challenge`, `control_timer`, `clear_board`), structured SLA/CAP extraction, and Playbook semantic search.
- `cactus-needle` (`Whistle`, 16.9 MB WASM) + `wasm-vad` (`AudioWorklet`) transcribe 16 kHz speech with dynamic Aho-Corasick biasing toward your live Excalidraw box labels.
- `kokoro-js` (`Kokoro-82M v1.0`, WebGPU `fp32` / WASM `q8`) synthesizes 24 kHz neural interviewer replies with instant VAD barge-in cutoff.
- `window.LanguageModel` (Chrome Gemini Nano) or `@mlc-ai/web-llm` (`Qwen 2.5 1.5B` / `Llama 3.2 1B`) drives Socratic follow-ups, backed by a `<5 ms` deterministic graph coach.

## 11 archetypes + Free-Flow mode

```bash
# Open directly in Free-Flow mode or any of the 11 canonical archetypes:
# seat-ticketing, social-timeline, cloud-file-sync, ride-dispatch,
# edge-rate-limiter, realtime-chat, stream-aggregator, code-runner,
# url-shortener, web-crawler, post-search
```

Every archetype ships with a 4-phase `35m` interview timer, 1-click SLA/CAP/API commitment chips, Staff+ stress drills, and a `Solution` blueprint (`Write Path`, `Read Path`, `Storage & Partitioning`, `Staff+ Failure & Scale Defenses`) that stamps directly onto the Excalidraw board.

## Tests

```bash
npm test
npm run test:e2e
npm run build
```

Runs Vitest topology/blueprint unit checks, Playwright headless Chrome E2E tests, and builds a subpath-portable bundle in `dist/`.

## Live

- [h3manth.com/ai/sysd](https://h3manth.com/ai/sysd/)

## License

MIT © [Hemanth.HM](https://h3manth.com)
