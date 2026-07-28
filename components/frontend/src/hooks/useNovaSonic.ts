"use client";
import { useRef, useState, useCallback } from "react";
import { getCognitoToken } from "@/lib/api";

// Append the Cognito token as a query param — browsers cannot set Authorization
// headers on WebSocket connections, so the server verifies ?token= instead.
function wsWithToken(url: string): string {
  const t = getCognitoToken();
  return t ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(t)}` : url;
}

// Same-origin WebSocket base, computed at RUNTIME. Static export prerenders with
// no `window`, so this must NOT be a build-time const. In prod the app is served
// by CloudFront which routes /stt,/tts → ALB → voice-nova (D-031/D-037).
function sonicWs(): string {
  const host = process.env.NEXT_PUBLIC_NOVA_SONIC_HOST;
  if (host) return `wss://${host}`;
  if (typeof window === "undefined") return "";
  if (window.location.hostname === "localhost")
    return `ws://localhost:${process.env.NEXT_PUBLIC_NOVA_SONIC_PORT || "8505"}`;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

/**
 * Nova Sonic STT+TTS hook with persistent voice session support.
 *
 * Two modes:
 *   1. One-shot STT (startSTT/stopSTT) — original push-to-talk behavior
 *   2. Persistent session (startSession/endSession) — mic stays open across turns,
 *      auto-resumes after TTS playback. VAD handles turn-taking.
 */
export function useNovaSonic() {
  const sttWsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  // Persistent session state
  const sessionActiveRef = useRef(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const pausedForTTSRef = useRef(false);
  // Callbacks stored for session re-use
  const sessionCallbacksRef = useRef<{
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
  } | null>(null);

  // --- Shared: acquire mic once, reuse across STT sessions ---
  const acquireMic = useCallback(async () => {
    if (mediaRef.current && mediaRef.current.active) return mediaRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    mediaRef.current = stream;
    return stream;
  }, []);

  const releaseMic = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
  }, []);

  // --- One-shot STT (original behavior, unchanged) ---
  const startSTT = useCallback((onPartial: (text: string) => void, onFinal: (text: string) => void, onReady?: () => void) => {
    setTranscript("");
    const ws = new WebSocket(wsWithToken(`${sonicWs()}/stt`));
    sttWsRef.current = ws;

    let completed = "";
    let pending = "";
    let submitTimer: ReturnType<typeof setTimeout> | null = null;
    const SILENCE_MS = 2000;
    const fullText = () => (completed + pending).trim();
    const scheduleSubmit = () => {
      if (submitTimer) clearTimeout(submitTimer);
      submitTimer = setTimeout(() => {
        const text = fullText();
        if (text) { onFinal(text); stopSTT(); }
      }, SILENCE_MS);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "transcript") {
        if (msg.text) {
          pending = msg.text;
          const display = fullText();
          setTranscript(display);
          onPartial(display);
          scheduleSubmit();
        } else if (msg.final) {
          if (pending) { completed += pending + " "; pending = ""; }
          scheduleSubmit();
        }
      }
    };

    ws.onopen = async () => {
      try {
        const stream = await acquireMic();
        setListening(true);
        onReady?.();
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        ctxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (ev) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const float32 = ev.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
          }
          const bytes = new Uint8Array(int16.buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          ws.send(JSON.stringify({ type: "audio", data: btoa(binary) }));
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      } catch (err) {
        console.error("Mic access failed:", err);
        setListening(false);
      }
    };

    ws.onclose = () => setListening(false);
    ws.onerror = () => setListening(false);
  }, [acquireMic]);

  const stopSTT = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    // Only release mic if not in persistent session
    if (!sessionActiveRef.current) {
      mediaRef.current?.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
    }
    if (sttWsRef.current?.readyState === WebSocket.OPEN) {
      sttWsRef.current.send(JSON.stringify({ type: "stop" }));
    }
    sttWsRef.current?.close();
    sttWsRef.current = null;
    setListening(false);
  }, []);

  // --- Persistent voice session ---

  /**
   * Open a new STT WebSocket and start streaming mic audio.
   * When silence is detected, calls onFinal and closes the WS —
   * but does NOT release the mic (persistent session keeps it).
   */
  const openSTTTurn = useCallback((stream: MediaStream) => {
    const cbs = sessionCallbacksRef.current;
    if (!cbs || !sessionActiveRef.current) return;

    setTranscript("");
    setListening(true);

    const ws = new WebSocket(wsWithToken(`${sonicWs()}/stt`));
    sttWsRef.current = ws;

    let completed = "";
    let pending = "";
    let submitTimer: ReturnType<typeof setTimeout> | null = null;
    const SILENCE_MS = 2000;
    const fullText = () => (completed + pending).trim();

    const scheduleSubmit = () => {
      if (submitTimer) clearTimeout(submitTimer);
      submitTimer = setTimeout(() => {
        const text = fullText();
        if (text) {
          // Close this STT turn — mic stays open, session continues
          setListening(false);
          setTranscript("");
          processorRef.current?.disconnect();
          processorRef.current = null;
          ctxRef.current?.close().catch(() => {});
          ctxRef.current = null;
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
          ws.close();
          sttWsRef.current = null;
          cbs.onFinal(text);
        }
      }, SILENCE_MS);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "transcript") {
        if (msg.text) {
          pending = msg.text;
          const display = fullText();
          setTranscript(display);
          cbs.onPartial(display);
          scheduleSubmit();
        } else if (msg.final) {
          if (pending) { completed += pending + " "; pending = ""; }
          scheduleSubmit();
        }
      }
    };

    ws.onopen = async () => {
      try {
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        ctxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (ev) => {
          if (ws.readyState !== WebSocket.OPEN || pausedForTTSRef.current) return;
          const float32 = ev.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
          }
          const bytes = new Uint8Array(int16.buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          ws.send(JSON.stringify({ type: "audio", data: btoa(binary) }));
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      } catch (err) {
        console.error("STT turn mic setup failed:", err);
        setListening(false);
      }
    };

    ws.onclose = () => {
      if (sessionActiveRef.current) setListening(false);
    };
    ws.onerror = () => {
      if (sessionActiveRef.current) setListening(false);
    };
  }, []);

  /**
   * Start a persistent voice session.
   * Mic opens once and stays open. STT turns cycle automatically.
   * After each utterance → onFinal fires → caller sends to LLM → calls speak() →
   * after TTS finishes → resumeListening() opens a new STT turn.
   */
  const startSession = useCallback(async (
    onPartial: (text: string) => void,
    onFinal: (text: string) => void,
  ) => {
    sessionCallbacksRef.current = { onPartial, onFinal };
    sessionActiveRef.current = true;
    setSessionActive(true);
    pausedForTTSRef.current = false;

    try {
      const stream = await acquireMic();
      openSTTTurn(stream);
    } catch (err) {
      console.error("Failed to start voice session:", err);
      sessionActiveRef.current = false;
      setSessionActive(false);
    }
  }, [acquireMic, openSTTTurn]);

  /** End the persistent voice session. Releases mic. */
  const endSession = useCallback(() => {
    sessionActiveRef.current = false;
    setSessionActive(false);
    pausedForTTSRef.current = false;
    sessionCallbacksRef.current = null;
    // Close any active STT turn
    processorRef.current?.disconnect();
    processorRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    if (sttWsRef.current?.readyState === WebSocket.OPEN) {
      sttWsRef.current.send(JSON.stringify({ type: "stop" }));
    }
    sttWsRef.current?.close();
    sttWsRef.current = null;
    releaseMic();
    setListening(false);
    setTranscript("");
    setSpeaking(false);
  }, [releaseMic]);

  /**
   * Resume listening after TTS playback or after LLM response.
   * Opens a new STT turn on the existing mic stream.
   */
  const resumeListening = useCallback(() => {
    if (!sessionActiveRef.current) return;
    pausedForTTSRef.current = false;
    const stream = mediaRef.current;
    if (!stream || !stream.active) {
      // Mic was lost — re-acquire
      acquireMic().then((s) => openSTTTurn(s)).catch(() => endSession());
      return;
    }
    openSTTTurn(stream);
  }, [acquireMic, openSTTTurn, endSession]);

  // --- TTS: text → Nova Sonic → audio playback ---
  // Track active TTS for cancellation (barge-in)
  const activeTTSRef = useRef<{ ws?: WebSocket; src?: AudioBufferSourceNode; ctx?: AudioContext; resolve?: () => void } | null>(null);

  const stopSpeaking = useCallback(() => {
    const active = activeTTSRef.current;
    if (!active) return;
    try { active.src?.stop(); } catch {}
    try { active.ws?.close(); } catch {}
    try { active.ctx?.close(); } catch {}
    active.resolve?.();
    activeTTSRef.current = null;
    setSpeaking(false);
    pausedForTTSRef.current = false;
  }, []);

  const speak = useCallback((text: string, voice = "matthew") => {
    pausedForTTSRef.current = true;
    setSpeaking(true);

    return new Promise<void>((resolve) => {
      const ws = new WebSocket(wsWithToken(`${sonicWs()}/tts`));
      const audioCtx = new AudioContext({ sampleRate: 24000 });
      const chunks: Float32Array[] = [];
      activeTTSRef.current = { ws, ctx: audioCtx, resolve };

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "speak", text, voice }));
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "audio" && msg.data) {
          const binary = atob(msg.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const int16 = new Int16Array(bytes.buffer);
          const float32 = new Float32Array(int16.length);
          for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
          chunks.push(float32);
        }
        if (msg.type === "done") {
          ws.close();
          const total = chunks.reduce((s, c) => s + c.length, 0);
          if (total === 0) {
            audioCtx.close();
            setSpeaking(false);
            pausedForTTSRef.current = false;
            resolve();
            return;
          }
          const merged = new Float32Array(total);
          let offset = 0;
          for (const c of chunks) { merged.set(c, offset); offset += c.length; }
          const buf = audioCtx.createBuffer(1, merged.length, 24000);
          buf.getChannelData(0).set(merged);
          const src = audioCtx.createBufferSource();
          src.buffer = buf;
          src.connect(audioCtx.destination);
          if (activeTTSRef.current) activeTTSRef.current.src = src;
          src.onended = () => {
            audioCtx.close();
            setSpeaking(false);
            pausedForTTSRef.current = false;
            activeTTSRef.current = null;
            resolve();
          };
          src.start();
        }
      };

      ws.onerror = () => {
        setSpeaking(false);
        pausedForTTSRef.current = false;
        activeTTSRef.current = null;
        resolve();
      };
      ws.onclose = () => {};
    });
  }, []);

  return {
    // One-shot STT
    listening, transcript, startSTT, stopSTT,
    // Persistent session
    sessionActive, speaking, startSession, endSession, resumeListening,
    // TTS
    speak, stopSpeaking,
  };
}
