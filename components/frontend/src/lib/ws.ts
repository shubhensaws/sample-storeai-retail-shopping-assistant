// Runtime same-origin WebSocket URL. Must be computed at runtime (not build time)
// because the static export prerenders with no `window`. In prod, CloudFront
// serves the app and routes the WS paths (/stt,/tts,/whisper,/ws) → ALB → service.
export function wsUrl(override: string | undefined, path: string): string {
  if (override) return override;
  if (typeof window === "undefined") return path;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}`;
}
