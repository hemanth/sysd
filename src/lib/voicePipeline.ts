import vad, { type VadDetector, type VadListenController } from 'wasm-vad';
import { CactusWhistleTranscriber } from './cactusRuntime';
import type { SttEngineChoice, VoiceStatus } from '../types';

export interface VoiceCallbacks {
  onTranscript: (text: string) => void;
  onBargeIn?: () => void;
  getKeywords?: () => string[];
}

function resolvePublicAsset(relPath: string): string {
  const base =
    typeof document !== 'undefined' && document.baseURI
      ? document.baseURI
      : typeof window !== 'undefined'
        ? window.location.href
        : 'http://localhost/';
  const u = new URL(base);
  u.hash = '';
  u.search = '';
  if (!u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/[^/]*$/, '/');
  }
  return new URL(relPath.replace(/^\//, ''), u.toString()).toString();
}

export class VoicePipelineController {
  private detector: VadDetector | null = null;
  private listenCtrl: VadListenController | null = null;
  private whistle = new CactusWhistleTranscriber();
  private sttWorker: Worker | null = null;
  private ttsWorker: Worker | null = null;
  private ttsReady = false;
  private audioCtx: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private latestTtsReqId = '';
  private speechRec: any = null;
  private latestBrowserTranscript = '';
  private status: VoiceStatus = {
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
  };
  private listeners = new Set<(status: VoiceStatus) => void>();
  private callbacks: VoiceCallbacks;
  private sttRequests = new Map<
    string,
    { resolve: (text: string) => void; reject: (err: Error) => void }
  >();

  constructor(callbacks: VoiceCallbacks) {
    this.callbacks = callbacks;
  }

  getStatus(): VoiceStatus {
    return this.status;
  }

  subscribe(fn: (status: VoiceStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<VoiceStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) {
      fn({ ...this.status });
    }
  }

  setTtsEnabled(enabled: boolean) {
    if (!enabled) {
      this.stopSpeaking();
    }
    this.update({ ttsEnabled: enabled });
  }

  async setSttChoice(choice: SttEngineChoice) {
    this.update({
      sttChoice: choice,
      sttBackend: choice === 'whistle' ? 'Cactus Whistle · 16.9 MB WASM' : 'Whisper Tiny · ONNX',
      sttReady: false,
      sttProgress: 0,
    });
    if (this.status.state !== 'off') {
      if (choice === 'whistle') {
        void this.warmupWhistle();
      } else {
        this.ensureWhisperWorker();
      }
    }
  }

  private ensureKokoroWorker() {
    if (this.ttsWorker || typeof Worker === 'undefined') return;
    try {
      this.ttsWorker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.ttsWorker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data;
        if (!msg) return;
        if (msg.type === 'ready') {
          this.ttsReady = true;
        } else if (
          msg.type === 'audio' &&
          msg.requestId &&
          msg.requestId === this.latestTtsReqId &&
          msg.pcm instanceof Float32Array
        ) {
          void this.playNeuralPcm(msg.pcm, msg.sampleRate || 24000, msg.requestId);
        } else if (msg.type === 'error' && msg.requestId && msg.requestId === this.latestTtsReqId) {
          if (this.status.state === 'speaking-coach') {
            this.update({ state: this.listenCtrl ? 'listening' : 'off' });
          }
        }
      };
      this.ttsWorker.postMessage({ type: 'warmup' });
    } catch {
      this.ttsWorker = null;
    }
  }

  private async playNeuralPcm(pcm: Float32Array, sampleRate: number, reqId: string) {
    if (!this.status.ttsEnabled || reqId !== this.latestTtsReqId) return;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new Ctor();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      if (reqId !== this.latestTtsReqId) return;

      if (this.activeSource) {
        try {
          this.activeSource.stop();
        } catch {
          // Ignore already stopped
        }
        this.activeSource = null;
      }

      const buffer = this.audioCtx.createBuffer(1, pcm.length, sampleRate);
      buffer.getChannelData(0).set(pcm);

      const src = this.audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.audioCtx.destination);
      this.activeSource = src;

      if (this.status.state !== 'speaking-user') {
        this.update({ state: 'speaking-coach' });
      }

      src.onended = () => {
        if (this.activeSource === src) {
          this.activeSource = null;
          if (this.status.state === 'speaking-coach') {
            this.update({ state: this.listenCtrl ? 'listening' : 'off' });
          }
        }
      };

      src.start(0);
    } catch {
      if (this.status.state === 'speaking-coach') {
        this.update({ state: this.listenCtrl ? 'listening' : 'off' });
      }
    }
  }

  async preloadAudioModels(): Promise<void> {
    try {
      this.ensureKokoroWorker();
      const whistlePromise = this.warmupWhistle();
      const vadPromise = (async () => {
        if (!this.detector) {
          try {
            this.detector = await vad({
              tier: 'mobile',
              modelUrl: resolvePublicAsset('models/vad-mobile.onnx'),
              minSpeechMs: 240,
              redemptionMs: 720,
              preSpeechPadMs: 240,
              positiveSpeechThreshold: 0.5,
              negativeSpeechThreshold: 0.35,
            });
          } catch {
            this.detector = await vad({
              tier: 'dsp',
              minSpeechMs: 260,
              redemptionMs: 720,
            });
          }
        }
      })();
      await Promise.allSettled([whistlePromise, vadPromise]);
    } catch {
      // Graceful opaque fallback
    }
  }

  async warmupWhistle(): Promise<void> {
    this.update({ sttLoading: true, sttBackend: 'Cactus Whistle · Loading…' });
    try {
      await this.whistle.ensureLoaded((pct) => {
        this.update({ sttLoading: true, sttProgress: pct });
      });
      this.update({
        sttReady: true,
        sttLoading: false,
        sttProgress: 100,
        sttBackend: 'Cactus Whistle · 16.9 MB WASM',
      });
    } catch (err) {
      this.update({
        sttLoading: false,
        sttChoice: 'whisper',
        sttBackend: 'Whisper Fallback',
        error: err instanceof Error ? err.message : undefined,
      });
      this.ensureWhisperWorker();
    }
  }

  private ensureWhisperWorker() {
    if (this.sttWorker) return;
    this.sttWorker = new Worker(new URL('../workers/stt.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.update({ sttLoading: true, sttProgress: 5 });

    this.sttWorker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        this.update({ sttLoading: true, sttProgress: msg.progress });
      } else if (msg.type === 'ready') {
        this.update({
          sttReady: true,
          sttLoading: false,
          sttProgress: 100,
          sttBackend: msg.backend,
        });
      } else if (msg.type === 'transcript' && msg.requestId) {
        const req = this.sttRequests.get(msg.requestId);
        if (req) {
          this.sttRequests.delete(msg.requestId);
          req.resolve(msg.text);
        }
      } else if (msg.type === 'error') {
        if (msg.requestId && this.sttRequests.has(msg.requestId)) {
          const req = this.sttRequests.get(msg.requestId)!;
          this.sttRequests.delete(msg.requestId);
          req.reject(new Error(msg.error));
        } else {
          this.update({
            sttLoading: false,
            sttBackend: 'Web Speech Fallback',
          });
        }
      }
    };

    this.sttWorker.postMessage({ type: 'warmup' });
  }

  private startInterimRecognition() {
    try {
      const w = globalThis as Record<string, any>;
      const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (!Ctor) return;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (event: any) => {
        let interim = '';
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalChunk += res[0].transcript + ' ';
          } else {
            interim += res[0].transcript;
          }
        }
        if (finalChunk.trim()) {
          this.latestBrowserTranscript = (this.latestBrowserTranscript + ' ' + finalChunk).trim();
        }
        this.update({ interimTranscript: interim.trim() || this.latestBrowserTranscript });
      };
      rec.onerror = () => {};
      rec.onend = () => {
        if (this.listenCtrl && this.status.state !== 'off') {
          try {
            rec.start();
          } catch {
            // Ignore restart race
          }
        }
      };
      rec.start();
      this.speechRec = rec;
    } catch {
      // Browser SpeechRecognition unavailable; Whistle WASM handles everything
    }
  }

  private stopInterimRecognition() {
    if (this.speechRec) {
      const rec = this.speechRec;
      this.speechRec = null;
      try {
        rec.stop();
      } catch {
        // Ignore
      }
    }
  }

  async startHandsFree(): Promise<void> {
    if (this.listenCtrl) return;
    this.update({ state: 'loading', error: undefined });
    this.ensureKokoroWorker();

    if (this.status.sttChoice === 'whistle') {
      void this.warmupWhistle();
    } else {
      this.ensureWhisperWorker();
    }

    try {
      if (!this.detector) {
        try {
          this.detector = await vad({
            tier: 'mobile',
            modelUrl: resolvePublicAsset('models/vad-mobile.onnx'),
            minSpeechMs: 240,
            redemptionMs: 720,
            preSpeechPadMs: 240,
            positiveSpeechThreshold: 0.5,
            negativeSpeechThreshold: 0.35,
          });
        } catch {
          this.detector = await vad({
            tier: 'dsp',
            minSpeechMs: 260,
            redemptionMs: 720,
          });
        }
      }

      const vadLabel = `${this.detector.info.tier.toUpperCase()} · ${this.detector.info.backend.toUpperCase()}`;
      let lastFrameEmit = 0;

      this.listenCtrl = await this.detector.listen({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        onFrame: (frame) => {
          const now = performance.now();
          if (now - lastFrameEmit > 45) {
            lastFrameEmit = now;
            this.update({
              level: Math.min(1, frame.rms * 7.5),
              probability: frame.probability,
            });
          }
        },
        onSpeechStart: () => {
          this.latestBrowserTranscript = '';
          this.stopSpeaking();
          this.callbacks.onBargeIn?.();
          this.update({ state: 'speaking-user', interimTranscript: '' });
        },
        onSpeechEnd: async (segment) => {
          if (segment.durationMs < 320) {
            this.update({ state: 'listening', interimTranscript: '' });
            return;
          }
          this.update({ state: 'transcribing' });
          const browserFallback = (
            this.latestBrowserTranscript || this.status.interimTranscript
          ).trim();
          this.latestBrowserTranscript = '';

          let finalTranscript = '';

          if (this.status.sttChoice === 'whistle') {
            try {
              const keywords = this.callbacks.getKeywords?.() ?? [];
              const res = await this.whistle.transcribePcm(segment.pcm, keywords);
              finalTranscript = res.text;
              this.update({
                lastTtftMs: res.ttftMs,
                lastTps: res.tokensPerSecond,
                sttBackend: `Whistle · ${res.ttftMs}ms TTFT`,
              });
            } catch {
              finalTranscript = browserFallback;
            }
          } else if (this.sttWorker && this.status.sttReady) {
            try {
              const requestId = `stt_${Date.now()}`;
              const pcmCopy = new Float32Array(segment.pcm);
              finalTranscript = await new Promise<string>((resolve, reject) => {
                this.sttRequests.set(requestId, { resolve, reject });
                this.sttWorker!.postMessage(
                  { type: 'transcribe', requestId, pcm: pcmCopy },
                  [pcmCopy.buffer],
                );
              });
            } catch {
              finalTranscript = browserFallback;
            }
          } else if (browserFallback) {
            finalTranscript = browserFallback;
          }

          this.update({
            state: this.listenCtrl ? 'listening' : 'off',
            interimTranscript: '',
          });

          const cleaned = finalTranscript.trim();
          if (cleaned.length >= 2) {
            this.callbacks.onTranscript(cleaned);
          }
        },
        onError: (err) => {
          this.update({
            state: 'off',
            error: err instanceof Error ? err.message : 'Microphone access denied or unavailable.',
          });
        },
      });

      this.startInterimRecognition();
      this.update({
        state: 'listening',
        vadBackend: vadLabel,
        error: undefined,
      });
    } catch (err) {
      this.listenCtrl = null;
      this.update({
        state: 'off',
        error: err instanceof Error ? err.message : 'Could not start microphone VAD.',
      });
    }
  }

  async stopHandsFree(): Promise<void> {
    this.stopInterimRecognition();
    this.stopSpeaking();
    if (this.listenCtrl) {
      const ctrl = this.listenCtrl;
      this.listenCtrl = null;
      await ctrl.stop();
    }
    this.update({
      state: 'off',
      level: 0,
      probability: 0,
      interimTranscript: '',
    });
  }

  stopSpeaking() {
    this.latestTtsReqId = '';
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        // Ignore
      }
      this.activeSource = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.status.state === 'speaking-coach') {
      this.update({ state: this.listenCtrl ? 'listening' : 'off' });
    }
  }

  speakCoachReply(text: string) {
    if (!this.status.ttsEnabled) return;
    const clean = text.replace(/[*_`#]/g, '').trim();
    if (!clean) return;

    this.stopSpeaking();
    this.ensureKokoroWorker();

    // Primary path: Kokoro-82M neural WebGPU/WASM synthesis (~4.45 MOS)
    if (this.ttsWorker && this.ttsReady) {
      const requestId = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.latestTtsReqId = requestId;
      this.ttsWorker.postMessage({
        type: 'speak',
        requestId,
        text: clean,
        voice: 'af_heart',
      });
      return;
    }

    // Cold-start fallback while Kokoro-82M finishes warming in background
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.03;
    utter.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(
        (v) =>
          /en(-|_)(US|GB)/i.test(v.lang) &&
          /(Natural|Enhanced|Premium|Samantha|Daniel|Ava)/i.test(v.name),
      ) ??
      voices.find((v) => /en/i.test(v.lang) && v.localService) ??
      voices.find((v) => /en/i.test(v.lang));
    if (preferred) {
      utter.voice = preferred;
    }

    utter.onstart = () => {
      if (this.status.state !== 'speaking-user') {
        this.update({ state: 'speaking-coach' });
      }
    };
    const restore = () => {
      if (this.status.state === 'speaking-coach') {
        this.update({ state: this.listenCtrl ? 'listening' : 'off' });
      }
    };
    utter.onend = restore;
    utter.onerror = restore;
    window.speechSynthesis.speak(utter);
  }

  async dispose() {
    await this.stopHandsFree();
    await this.whistle.dispose();
    await this.detector?.dispose();
    this.detector = null;
    this.sttWorker?.terminate();
    this.sttWorker = null;
    this.ttsWorker?.terminate();
    this.ttsWorker = null;
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
