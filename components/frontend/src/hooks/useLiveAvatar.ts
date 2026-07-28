"use client";
import { useRef, useState, useCallback } from "react";
import { wsUrl } from "@/lib/ws";

/**
 * Hook for LiveAvatar text relay.
 * Sends agent response text → avatar speaks with lip-sync.
 */
export function useLiveAvatar() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const ws = new WebSocket(wsUrl(process.env.NEXT_PUBLIC_LIVEAVATAR_URL, "/ws"));
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    wsRef.current = ws;
  }, []);

  const speak = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "speak", text }));
  }, []);

  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    setConnected(false);
  }, []);

  return { connected, connect, speak, interrupt, disconnect };
}
