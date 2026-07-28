"use client";
import { useRef, useState, useCallback } from "react";
import { wsUrl } from "@/lib/ws";

/**
 * Hook for Whisper live transcription via WebSocket.
 * Sends audio chunks, receives live transcription text.
 * This solves the Streamlit limitation — React can update DOM in real-time.
 */
export function useWhisper() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);

  const connect = useCallback(() => {
    const ws = new WebSocket(wsUrl(process.env.NEXT_PUBLIC_WHISPER_URL, "/whisper"));
    ws.onopen = () => { setConnected(true); setIsListening(true); };
    ws.onclose = () => { setConnected(false); setIsListening(false); };
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.text) setTranscript(data.text);
      if (data.final) setIsListening(false);
    };
    wsRef.current = ws;
  }, []);

  const sendAudio = useCallback((b64chunk: string) => {
    wsRef.current?.send(JSON.stringify({ audio: b64chunk }));
  }, []);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    wsRef.current?.close();
    setIsListening(false);
  }, []);

  return { connected, transcript, isListening, connect, sendAudio, stop };
}
