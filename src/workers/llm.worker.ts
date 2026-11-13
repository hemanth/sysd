import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm';

let engine: MLCEngine | null = null;
let loadedModelId = '';

export interface WorkerRequest {
  type: 'load' | 'generate' | 'abort';
  requestId?: string;
  modelId?: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'abort') {
    if (engine) {
      engine.interruptGenerate();
    }
    return;
  }

  if (msg.type === 'load' && msg.modelId) {
    try {
      if (engine && loadedModelId === msg.modelId) {
        self.postMessage({ type: 'loaded', modelId: loadedModelId });
        return;
      }
      engine = await CreateMLCEngine(msg.modelId, {
        initProgressCallback: (report) => {
          self.postMessage({
            type: 'progress',
            progress: Math.round((report.progress ?? 0) * 100),
            text: report.text ?? 'Loading WebGPU weights…',
          });
        },
      });
      loadedModelId = msg.modelId;
      self.postMessage({ type: 'loaded', modelId: loadedModelId });
    } catch (err) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === 'generate' && msg.messages && msg.requestId) {
    if (!engine) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: 'WebGPU model is not loaded yet.',
      });
      return;
    }

    try {
      const chunks = await engine.chat.completions.create({
        messages: msg.messages,
        temperature: 0.35,
        max_tokens: 170,
        stream: true,
      });

      let full = '';
      for await (const chunk of chunks) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          self.postMessage({
            type: 'token',
            requestId: msg.requestId,
            delta,
            full,
          });
        }
      }
      self.postMessage({
        type: 'done',
        requestId: msg.requestId,
        full: full.trim(),
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
