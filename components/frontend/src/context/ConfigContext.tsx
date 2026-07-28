"use client";
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import type { VTONEngine, DemoMode, BoothStation } from "@/lib/types";

export type ChatModel = "claude-haiku-4.5" | "claude-sonnet-4.6" | "claude-opus-4.1" | "nova-pro" | "qwen3";
export type STTEngine = "browser" | "whisper" | "nova-sonic";

const STORAGE_KEY = "storeai-settings";

interface PersistedSettings {
  chatModel: ChatModel;
  vtonEngine: VTONEngine;
  voiceMode: boolean;
  novaSonicVoice: string;
  inlineTryon: boolean;
  debugMode: boolean;
  saveChat: boolean;
  autoReadAloud: boolean;
  liveAvatarEnabled: boolean;
  photoUploadEnabled: boolean;
  sttEngine: STTEngine;
  sidebarOpen: boolean;
  boothStation: BoothStation;
  boothItemCap: number;
  autoQueueSignIn: boolean;
  markerColor: "red" | "blue" | "green";
  markerHeight: number;
  vtonSteps: number;
  vtonCfgScale: number;
  vtonSeed: number;
}

const defaultSettings: PersistedSettings = {
  chatModel: "claude-haiku-4.5",
  vtonEngine: "fashn_vton",
  voiceMode: false,
  novaSonicVoice: "matthew",
  inlineTryon: false,
  debugMode: false,
  saveChat: true,
  autoReadAloud: false,
  liveAvatarEnabled: false,
  photoUploadEnabled: true,
  sttEngine: "browser",
  sidebarOpen: true,
  boothStation: "shopping",
  boothItemCap: 5,
  autoQueueSignIn: true,
  markerColor: "red",
  markerHeight: 150,
  vtonSteps: 50,
  vtonCfgScale: 3.0,
  vtonSeed: 42,
};

function loadSettings(): PersistedSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch { return defaultSettings; }
}

function saveSettings(s: PersistedSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

interface ConfigState extends PersistedSettings {
  setChatModel: (m: ChatModel) => void;
  setVtonEngine: (e: VTONEngine) => void;
  setVoiceMode: (v: boolean) => void;
  setNovaSonicVoice: (v: string) => void;
  setInlineTryon: (v: boolean) => void;
  setDebugMode: (v: boolean) => void;
  setSaveChat: (v: boolean) => void;
  setAutoReadAloud: (v: boolean) => void;
  setLiveAvatarEnabled: (v: boolean) => void;
  setPhotoUploadEnabled: (v: boolean) => void;
  setSttEngine: (e: STTEngine) => void;
  setSidebarOpen: (o: boolean) => void;
  setBoothStation: (s: BoothStation) => void;
  setBoothItemCap: (n: number) => void;
  setAutoQueueSignIn: (v: boolean) => void;
  setMarkerColor: (v: "red" | "blue" | "green") => void;
  setMarkerHeight: (n: number) => void;
  setVtonSteps: (v: number) => void;
  setVtonCfgScale: (v: number) => void;
  setVtonSeed: (v: number) => void;
  demoMode: DemoMode;
  sessionCost: { llm: number; vton: number; stt: number; infra: number; llmCalls: number; vtonImages: number; sttSec: number };
  selectionCost: number;
  setSelectionCost: (n: number) => void;
  addCost: (category: "llm" | "vton" | "stt" | "infra", usd: number, meta?: { calls?: number; images?: number; sec?: number }) => void;
  resetCost: () => void;
}

const ConfigContext = createContext<ConfigState>({
  ...defaultSettings,
  setChatModel: () => {}, setVtonEngine: () => {}, setVoiceMode: () => {},
  setNovaSonicVoice: () => {}, setInlineTryon: () => {}, setDebugMode: () => {},
  setSaveChat: () => {}, setAutoReadAloud: () => {}, setLiveAvatarEnabled: () => {},
  setPhotoUploadEnabled: () => {}, setSttEngine: () => {}, setSidebarOpen: () => {},
  setBoothStation: () => {}, demoMode: "standard",
  setBoothItemCap: () => {},
  setAutoQueueSignIn: () => {},
  setMarkerColor: () => {},
  setMarkerHeight: () => {},
  sessionCost: { llm: 0, vton: 0, stt: 0, infra: 0, llmCalls: 0, vtonImages: 0, sttSec: 0 },
  selectionCost: 0, setSelectionCost: () => {},
  addCost: () => {}, resetCost: () => {},
  setVtonSteps: () => {}, setVtonCfgScale: () => {}, setVtonSeed: () => {},
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PersistedSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setSettings(loadSettings()); setHydrated(true); }, []);
  useEffect(() => { if (hydrated) saveSettings(settings); }, [settings, hydrated]);

  const update = useCallback(<K extends keyof PersistedSettings>(key: K, val: PersistedSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: val }));
  }, []);

  // Demo mode: URL param ?mode=booth takes priority, then env var, then "booth" default for Summit
  const [demoMode, setDemoMode] = useState<DemoMode>("booth");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get("mode") as DemoMode | null;
    if (urlMode && ["standard", "booth"].includes(urlMode)) {
      setDemoMode(urlMode);
    } else {
      setDemoMode((process.env.NEXT_PUBLIC_DEMO_MODE as DemoMode) || "booth");
    }
  }, []);

  const emptyCost = { llm: 0, vton: 0, stt: 0, infra: 0, llmCalls: 0, vtonImages: 0, sttSec: 0 };
  const [sessionCost, setSessionCost] = useState(emptyCost);
  const [selectionCost, setSelectionCost] = useState(0);
  const addCost = useCallback((category: "llm" | "vton" | "stt" | "infra", usd: number, meta?: { calls?: number; images?: number; sec?: number }) => {
    setSessionCost((prev) => ({
      ...prev, [category]: prev[category] + usd,
      ...(meta?.calls ? { llmCalls: prev.llmCalls + meta.calls } : {}),
      ...(meta?.images ? { vtonImages: prev.vtonImages + meta.images } : {}),
      ...(meta?.sec ? { sttSec: prev.sttSec + meta.sec } : {}),
    }));
  }, []);
  const resetCost = useCallback(() => setSessionCost(emptyCost), []);

  return (
    <ConfigContext.Provider value={{
      ...settings,
      setChatModel: (v) => update("chatModel", v),
      setVtonEngine: (v) => update("vtonEngine", v),
      setVoiceMode: (v) => update("voiceMode", v),
      setNovaSonicVoice: (v) => update("novaSonicVoice", v),
      setInlineTryon: (v) => update("inlineTryon", v),
      setDebugMode: (v) => update("debugMode", v),
      setSaveChat: (v) => update("saveChat", v),
      setAutoReadAloud: (v) => update("autoReadAloud", v),
      setLiveAvatarEnabled: (v) => update("liveAvatarEnabled", v),
      setPhotoUploadEnabled: (v) => update("photoUploadEnabled", v),
      setSttEngine: (v) => update("sttEngine", v),
      setSidebarOpen: (v) => update("sidebarOpen", v),
      setBoothStation: (v) => update("boothStation", v),
      setBoothItemCap: (v) => update("boothItemCap", v),
      setAutoQueueSignIn: (v) => update("autoQueueSignIn", v),
      setMarkerColor: (v) => update("markerColor", v),
      setMarkerHeight: (v) => update("markerHeight", v),
      setVtonSteps: (v) => update("vtonSteps", v),
      setVtonCfgScale: (v) => update("vtonCfgScale", v),
      setVtonSeed: (v) => update("vtonSeed", v),
      demoMode, sessionCost, addCost, resetCost, selectionCost, setSelectionCost,
    }}>
      {children}
    </ConfigContext.Provider>
  );
}

export const useConfig = () => useContext(ConfigContext);
