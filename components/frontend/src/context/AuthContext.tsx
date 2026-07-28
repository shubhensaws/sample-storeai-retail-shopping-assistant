"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import type { Customer } from "@/lib/types";
import * as api from "@/lib/api";

interface AuthState {
  sessionId: string | null;
  customer: Customer | null;
  setCustomer: (c: Customer | null) => void;
  cartCount: number;
  tryonCount: number;
  refreshCounts: () => void;
  signIn: (phone?: string, customerId?: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState>({
  sessionId: null, customer: null, setCustomer: () => {},
  cartCount: 0, tryonCount: 0, refreshCounts: () => {},
  signIn: async () => {}, signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [customer, setCustomerRaw] = useState<Customer | null>(null);

  // Persist customer to localStorage
  const setCustomer = useCallback((c: Customer | null) => {
    setCustomerRaw(c);
    if (typeof window !== "undefined") {
      if (c?.customer_id) localStorage.setItem("storeai_cid", c.customer_id);
      else localStorage.removeItem("storeai_cid");
    }
  }, []);

  // Restore customer from localStorage on mount — re-fetch fresh profile
  useEffect(() => {
    const cid = localStorage.getItem("storeai_cid");
    if (!cid) return;
    api.signIn({ customer_id: cid }).then((c) => {
      if (c?.customer_id) setCustomerRaw(c);
      else localStorage.removeItem("storeai_cid");
    }).catch(() => localStorage.removeItem("storeai_cid"));
  }, []);
  const [cartCount, setCartCount] = useState(0);
  const [tryonCount, setTryonCount] = useState(0);

  const refreshCounts = useCallback(() => {
    if (!customer) { setCartCount(0); setTryonCount(0); return; }
    api.getCart(customer.customer_id).then((r) => setCartCount((r.items || []).length)).catch(() => {});
    api.getTryOnRoom(customer.customer_id).then((r) => setTryonCount((r.items || []).length)).catch(() => {});
  }, [customer]);

  // Refresh counts when customer changes
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  const signIn = useCallback(async (phone?: string, customerId?: string) => {
    const res = await api.signIn({ phone, customer_id: customerId });
    if (res?.customer_id) {
      setCustomer(res);
    } else if (res?.customer) {
      setSessionId(res.session_id);
      setCustomer(res.customer);
    }
  }, []);

  const signOut = useCallback(() => {
    if (sessionId) api.signOut(sessionId).catch(() => {});
    setSessionId(null);
    setCustomerRaw(null);
    if (typeof window !== "undefined") localStorage.removeItem("storeai_cid");
  }, [sessionId]);

  return (
    <AuthContext.Provider value={{ sessionId, customer, setCustomer, cartCount, tryonCount, refreshCounts, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
