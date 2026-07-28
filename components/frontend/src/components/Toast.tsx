"use client";
import { useState, useEffect, useCallback, createContext, useContext } from "react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextType {
  toast: (message: string, type?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() { return useContext(ToastContext); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  let counter = 0;

  const toast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-notification toast-${t.type}`}>
            {t.type === "success" && "✓ "}{t.type === "error" && "✕ "}{t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
