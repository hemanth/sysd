import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

let transcriber: any = null;
let loadingPromise: Promise<any> | null = null;

async function ensureTranscriber() {
  if (transcriber) return transcriber;
  if (loadingPromise) return loadingPromise;

  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  loadingPromise = (async () => {
    try {
      const pipe = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
        device: hasWebGpu ? 'webgpu' : 'wasm',
        dtype: hasWebGpu
          ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
          : 'q8',
        progress_callback: (info: any) => {
          if (typeof info?.progress === 'number') {
            self.postMessage({
              type: 'progress',
              progress: Math.round(info.progress),
            });
          }
        },
      });
      transcriber = pipe;
      self.postMessage({
        type: 'ready',
        backend: hasWebGpu ? 'Whisper Tiny · WebGPU' : 'Whisper Tiny · WASM',
      });
      return pipe;
    } catch {
      const fallbackPipe = await pipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-tiny.en',
        {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: (info: any) => {
            if (typeof info?.progress === 'number') {
              self.postMessage({
                type: 'progress',
                progress: Math.round(info.progress),
              });
            }
          },
        },
      );
      transcriber = fallbackPipe;
      self.postMessage({
        type: 'ready',
        backend: 'Whisper Tiny · WASM',
      });
      return fallbackPipe;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;

  if (msg.type === 'warmup') {
    try {
      await ensureTranscriber();
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === 'transcribe' && msg.pcm instanceof Float32Array) {
    try {
      const asr = await ensureTranscriber();
      const out = await asr(msg.pcm, {
        chunk_length_s: 25,
        stride_length_s: 4,
        return_timestamps: false,
      });
      const text = (typeof out?.text === 'string' ? out.text : '')
        .replace(/\[BLANK_AUDIO\]|\(blank audio\)|\[.*?\]/gi, '')
        .trim();
      self.postMessage({
        type: 'transcript',
        requestId: msg.requestId,
        text,
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
