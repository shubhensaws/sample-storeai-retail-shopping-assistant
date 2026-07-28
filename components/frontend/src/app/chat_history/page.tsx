"use client";
import { useState, useEffect } from "react";
import * as api from "@/lib/api";

interface Session { session_id: string; customer_id: string; customer_name: string; last_message: string }
interface Msg { role: string; content: string; timestamp: string; customer_id?: string }

export default function ChatHistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_LAMBDA_API_URL}/load_chat_history`)
      .then(r => r.json()).then(d => setSessions(d.sessions || [])).catch(() => {});
  }, []);

  const loadSession = async (sid: string) => {
    setSelected(sid);
    setLoading(true);
    try {
      const r = await api.loadChatHistory(sid, 100);
      setMessages(r?.messages || []);
    } catch { setMessages([]); }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui" }}>
      {/* Sessions list */}
      <div style={{ width: 320, borderRight: "1px solid #e5e7eb", overflowY: "auto", background: "#f9fafb" }}>
        <h2 style={{ padding: "16px", margin: 0, fontSize: 18, borderBottom: "1px solid #e5e7eb" }}>
          💬 Chat Sessions ({sessions.length})
        </h2>
        {sessions.map(s => (
          <div key={s.session_id} onClick={() => loadSession(s.session_id)}
            style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #f0f0f0",
              background: selected === s.session_id ? "#e0e7ff" : "transparent" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#232f3e" }}>
              {s.customer_name || "Anonymous"}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              {s.customer_id !== "anonymous" ? s.customer_id : ""} · {s.session_id.slice(0, 12)}… · {new Date(s.last_message).toLocaleString()}
            </div>
          </div>
        ))}
        {sessions.length === 0 && <p style={{ padding: 16, color: "#9ca3af" }}>No sessions found</p>}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {!selected && <p style={{ color: "#9ca3af", textAlign: "center", marginTop: 100 }}>Select a session to view messages</p>}
        {loading && <p style={{ color: "#6b7280" }}>Loading...</p>}
        {selected && !loading && messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 16, display: "flex", flexDirection: "column",
            alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "70%", padding: "10px 14px", borderRadius: 12,
              background: m.role === "user" ? "#232f3e" : "#f3f4f6",
              color: m.role === "user" ? "#fff" : "#1f2937", fontSize: 14, whiteSpace: "pre-wrap" }}>
              {m.content}
            </div>
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
              {m.role} · {new Date(m.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
        {selected && !loading && messages.length === 0 && <p style={{ color: "#9ca3af" }}>No messages in this session</p>}
      </div>
    </div>
  );
}
