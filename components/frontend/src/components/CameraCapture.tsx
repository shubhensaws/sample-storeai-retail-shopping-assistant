"use client";
import { useState, useRef, useEffect, useCallback } from "react";

interface Props {
  onCapture: (base64: string) => void;
  onClose: () => void;
  autoCapture?: boolean;
  countdownSeconds?: number;
}

export default function CameraCapture({ onCapture, onClose, autoCapture = false, countdownSeconds = 10 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(autoCapture ? countdownSeconds : null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraInfo, setCameraInfo] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<"starting" | "listening" | "heard" | "off">("starting");
  const capturedRef = useRef(false);

  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === "videoinput");

      let deviceId: string | undefined;
      let preferredLabel = "";
      const external = videoDevices.find(d => /obsbot|obs bot|obsycam|usb|external/i.test(d.label));
      if (external) {
        deviceId = external.deviceId;
        preferredLabel = external.label;
      } else if (videoDevices.length > 1) {
        deviceId = videoDevices[videoDevices.length - 1].deviceId;
        preferredLabel = videoDevices[videoDevices.length - 1].label || "External camera";
      } else if (videoDevices.length === 1) {
        preferredLabel = videoDevices[0].label || "Camera";
      }

      const baseVideo = { width: { ideal: 3840, min: 1280 }, height: { ideal: 2160, min: 720 } };
      const fallbackVideo = { width: { ideal: 1280 }, height: { ideal: 720 } };

      let stream: MediaStream | null = null;

      // Try preferred camera first, fall back to any available camera
      if (deviceId) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { ...baseVideo, deviceId: { exact: deviceId } } });
          setCameraInfo(preferredLabel);
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { ...fallbackVideo, deviceId: { exact: deviceId } } });
            setCameraInfo(preferredLabel);
          } catch {
            stream = null;
          }
        }
      }

      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: baseVideo });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: fallbackVideo });
        }
        const fallbackTrack = stream.getVideoTracks()[0];
        const fallbackLabel = fallbackTrack.label || "Default camera";
        setCameraInfo(deviceId ? `${fallbackLabel} (preferred unavailable)` : fallbackLabel);
      }

      streamRef.current = stream;
      const settings = stream.getVideoTracks()[0].getSettings();
      setCameraInfo(prev => `${prev.split(" (")[0]} (${settings.width}×${settings.height})`);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current?.play(); setReady(true); };
      }
    } catch (err: any) {
      setError(err.message || "Camera access denied");
    }
  }, []);

  // Start camera on mount
  useEffect(() => {
    let cancelled = false;
    startCamera().then(() => { if (cancelled) streamRef.current?.getTracks().forEach(t => t.stop()); });
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [startCamera]);

  // Countdown timer (fallback if voice isn't available)
  useEffect(() => {
    if (!ready || countdown === null || countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(timer);
  }, [ready, countdown]);

  useEffect(() => {
    if (countdown === 0 && ready && !capturedRef.current) capturePhoto();
  }, [countdown, ready]);

  // Voice recognition — listen for "click", "capture", "take", "shoot", "snap", "cheese"
  useEffect(() => {
    if (!ready || capturedRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      // No speech API — fall back to countdown
      setVoiceStatus("off");
      if (!autoCapture) setCountdown(countdownSeconds);
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    recRef.current = rec;

    const triggerWords = /\b(click|capture|take|shoot|snap|cheese|picture|photo)\b/i;

    rec.onresult = (e: any) => {
      if (capturedRef.current) return;
      const results = Array.from(e.results) as any[];
      for (const r of results) {
        const text = r[0].transcript;
        if (triggerWords.test(text)) {
          setVoiceStatus("heard");
          rec.stop();
          // 3s countdown before capture
          setCountdown(3);
          return;
        }
      }
    };

    rec.onstart = () => setVoiceStatus("listening");
    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") {
        // Restart silently
        if (!capturedRef.current) try { rec.start(); } catch {}
      } else {
        setVoiceStatus("off");
        if (!autoCapture) setCountdown(countdownSeconds);
      }
    };
    rec.onend = () => {
      // Restart if not captured yet
      if (!capturedRef.current && voiceStatus !== "off") {
        try { rec.start(); } catch {}
      }
    };

    // Stop countdown — voice takes priority
    setCountdown(null);
    try { rec.start(); } catch {
      setVoiceStatus("off");
      if (!autoCapture) setCountdown(countdownSeconds);
    }

    return () => { try { rec.stop(); } catch {} recRef.current = null; };
  }, [ready]);

  const capturePhoto = useCallback(() => {
    if (capturedRef.current && captured) return; // already captured
    capturedRef.current = true;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Crop to 2:3 portrait from center-top
    const targetRatio = 1 / 2;
    const frameRatio = vw / vh;
    let srcX = 0, srcY = 0, srcW = vw, srcH = vh;
    if (frameRatio > targetRatio) {
      srcW = Math.round(vh * targetRatio);
      srcX = Math.round((vw - srcW) / 2);
    } else {
      srcH = Math.round(vw / targetRatio);
      srcY = 0;
    }

    const outW = 512;
    const outH = 1024;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const base64 = dataUrl.split(",")[1];
    setCaptured(dataUrl);

    // Stop voice recognition and camera
    try { recRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    setTimeout(() => onCapture(base64), 1200);
  }, [onCapture, captured]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onClose}>
        <div className="bg-white rounded-sm p-6 max-w-sm text-center" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-[hsl(0,72%,51%)] mb-3">Camera error: {error}</p>
          <button onClick={onClose} className="text-xs bg-[hsl(0,0%,12%)] text-white px-4 py-1.5 rounded-sm">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="relative mx-4" style={{ maxWidth: "480px", width: "100%" }} onClick={e => e.stopPropagation()}>
        {/* Camera feed — tall 2:3 portrait */}
        <div className="relative rounded-sm overflow-hidden bg-black" style={{ aspectRatio: "2/3", maxHeight: "85vh" }}>
          {captured ? (
            <img src={captured} alt="Captured" className="w-full h-full object-contain bg-black" />
          ) : (
            <video ref={videoRef} autoPlay playsInline muted
              className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
          )}

          {/* Guide overlay */}
          {!captured && ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="border-2 border-white/30 rounded-lg" style={{ width: "40%", height: "85%", borderStyle: "dashed" }} />
              <p className="text-white/70 text-[10px] mt-2 tracking-wider uppercase">Stand in the frame — full body, head to toe</p>
            </div>
          )}

          {/* Voice listening indicator */}
          {!captured && ready && voiceStatus === "listening" && (
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <div className="bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-2">
                <div className="flex gap-0.5 items-end h-3">
                  <span className="w-0.5 h-1.5 bg-green-400 rounded-full animate-pulse" style={{animationDelay: "0ms"}} />
                  <span className="w-0.5 h-2.5 bg-green-400 rounded-full animate-pulse" style={{animationDelay: "150ms"}} />
                  <span className="w-0.5 h-1 bg-green-400 rounded-full animate-pulse" style={{animationDelay: "300ms"}} />
                  <span className="w-0.5 h-3 bg-green-400 rounded-full animate-pulse" style={{animationDelay: "100ms"}} />
                </div>
                <span className="text-white/80 text-[10px]">Say &quot;click&quot; to capture</span>
              </div>
            </div>
          )}

          {/* Countdown fallback (shown when voice not available) */}
          {countdown !== null && countdown > 3 && ready && !captured && (
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <div className="bg-black/50 backdrop-blur-sm rounded-full px-4 py-2 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-lg font-light tabular-nums">{countdown}s</span>
              </div>
            </div>
          )}

          {/* Big centered countdown for voice-triggered capture (3, 2, 1) */}
          {countdown !== null && countdown > 0 && countdown <= 3 && ready && !captured && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[140px] font-bold text-white/50 tabular-nums drop-shadow-lg">{countdown}</span>
            </div>
          )}

          {/* Captured checkmark */}
          {captured && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="hsl(142,71%,45%)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
          )}

          {/* Status bar */}
          {!captured ? (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
              <p className="text-white text-xs text-center">
                {!ready ? "Starting camera..." :
                 voiceStatus === "listening" ? "Say \"click\" or \"capture\" when ready — or press the button below" :
                 countdown !== null && countdown > 0 ? "Photo in " + countdown + "s — or press the button" :
                 "Ready — press the button to capture"}
              </p>
              {cameraInfo && <p className="text-white/50 text-[9px] text-center mt-1">{cameraInfo}</p>}
            </div>
          ) : (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
              <p className="text-white text-xs text-center">Photo captured — uploading...</p>
            </div>
          )}
        </div>

        {/* Manual capture button */}
        {!captured && ready && (
          <div className="flex justify-center mt-4">
            <button onClick={capturePhoto}
              className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/40 transition-colors flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-white" />
            </button>
          </div>
        )}

        <button onClick={onClose}
          className="absolute top-3 right-3 text-white/80 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm">
          ×
        </button>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
