/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';

let ttsInstance: KokoroTTS | null = null;
let loadPromise: Promise<KokoroTTS> | null = null;
let activeBackend = 'Kokoro-82M';

async function detectWorkerWebGpu(): Promise<boolean> {
  try {
    const nav = self.navigator as Navigator & {
      gpu?: { requestAdapter?: () => Promise<unknown | null> };
    };
    if (!nav?.gpu?.requestAdapter) return false;
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function ensureKokoroLoaded(): Promise<KokoroTTS> {
  if (ttsInstance) return ttsInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const useWebGpu = await detectWorkerWebGpu();

    const reportProgress = (info: { progress?: number; status?: string }) => {
      if (typeof info?.progress === 'number') {
        self.postMessage({
          type: 'progress',
          progress: Math.round(info.progress),
          status: info.status ?? 'loading',
        });
      }
    };

    if (useWebGpu) {
      try {
        const inst = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'fp32',
          device: 'webgpu',
          progress_callback: reportProgress,
        });
        activeBackend = 'Kokoro-82M · WebGPU';
        ttsInstance = inst;
        self.postMessage({ type: 'ready', backend: activeBackend });
        return inst;
      } catch {
        // Fall through cleanly to quantized WASM SIMD
      }
    }

    const inst = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: reportProgress,
    });
    activeBackend = 'Kokoro-82M · WASM q8';
    ttsInstance = inst;
    self.postMessage({ type: 'ready', backend: activeBackend });
    return inst;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'warmup') {
    try {
      await ensureKokoroLoaded();
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : 'Kokoro-82M warmup failed',
      });
    }
    return;
  }

  if (msg.type === 'speak' && typeof msg.text === 'string' && msg.requestId) {
    try {
      const tts = await ensureKokoroLoaded();
      const raw = await tts.generate(msg.text, {
        voice: msg.voice || DEFAULT_VOICE,
        speed: 1.04,
      });
      const pcm = new Float32Array(raw.audio);
      const sampleRate = raw.sampling_rate || 24000;
      self.postMessage(
        {
          type: 'audio',
          requestId: msg.requestId,
          pcm,
          sampleRate,
          backend: activeBackend,
        },
        [pcm.buffer],
      );
    } catch (err) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : 'Kokoro-82M synthesis failed',
      });
    }
  }
};
