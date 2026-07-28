"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserSession } from "amazon-cognito-identity-js";
import { setCognitoTokenGetter } from "@/lib/api";

const POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "";
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_WEB_CLIENT_ID || "";

const userPool = POOL_ID && CLIENT_ID ? new CognitoUserPool({ UserPoolId: POOL_ID, ClientId: CLIENT_ID }) : null;

// Sentinel returned by login() when Cognito requires the user to set a new password
// (first sign-in after an admin-created / email-invited account).
export const NEW_PASSWORD_REQUIRED = "NEW_PASSWORD_REQUIRED";

interface CognitoAuth {
  isAuthenticated: boolean;
  idToken: string | null;
  login: (username: string, password: string) => Promise<string | null>;
  completeNewPassword: (newPassword: string) => Promise<string | null>;
  logout: () => void;
}

const CognitoContext = createContext<CognitoAuth>({ isAuthenticated: false, idToken: null, login: async () => "Not configured", completeNewPassword: async () => "Not configured", logout: () => {} });

export function CognitoAuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const pendingUserRef = useRef<CognitoUser | null>(null);
  const setToken = (t: string | null) => { tokenRef.current = t; setIdToken(t); };

  // Restore session on mount + auto-refresh before expiry
  useEffect(() => {
    if (!userPool) { setChecked(true); return; }
    const refreshSession = () => {
      const user = userPool.getCurrentUser();
      if (!user) { setToken(null); setChecked(true); return; }
      user.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (!err && session?.isValid()) {
          setToken(session.getIdToken().getJwtToken());
          // Schedule refresh 5 min before expiry
          const exp = session.getIdToken().getExpiration() * 1000;
          const ms = Math.max(exp - Date.now() - 300000, 10000);
          setTimeout(refreshSession, ms);
        } else {
          setToken(null);
        }
        setChecked(true);
      });
    };
    refreshSession();
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    if (!userPool) return "Cognito not configured";
    return new Promise((resolve) => {
      const user = new CognitoUser({ Username: username, Pool: userPool });
      user.authenticateUser(new AuthenticationDetails({ Username: username, Password: password }), {
        onSuccess: (session) => { setToken(session.getIdToken().getJwtToken()); resolve(null); },
        onFailure: (err) => resolve(err.message || "Login failed"),
        newPasswordRequired: () => {
          // First sign-in for an admin-created / email-invited user: hand off to the
          // set-new-password step instead of silently reusing the temporary password.
          pendingUserRef.current = user;
          resolve(NEW_PASSWORD_REQUIRED);
        },
      });
    });
  }, []);

  const completeNewPassword = useCallback(async (newPassword: string): Promise<string | null> => {
    const user = pendingUserRef.current;
    if (!user) return "No password challenge in progress — please sign in again.";
    return new Promise((resolve) => {
      user.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: (session) => { setToken(session.getIdToken().getJwtToken()); pendingUserRef.current = null; resolve(null); },
        onFailure: (err) => resolve(err.message || "Could not set the new password"),
      });
    });
  }, []);

  const logout = useCallback(() => {
    if (userPool) userPool.getCurrentUser()?.signOut();
    setToken(null);
  }, []);

  // Wire token getter for api.ts
  useEffect(() => { setCognitoTokenGetter(() => tokenRef.current); }, []);

  if (!checked) return null;

  // No Cognito configured — pass through (local dev)
  if (!userPool) return <CognitoContext.Provider value={{ isAuthenticated: true, idToken: null, login, completeNewPassword, logout }}>{children}</CognitoContext.Provider>;

  if (!idToken) return <LoginScreen onLogin={login} onCompleteNewPassword={completeNewPassword} />;

  return <CognitoContext.Provider value={{ isAuthenticated: true, idToken, login, completeNewPassword, logout }}>{children}</CognitoContext.Provider>;
}

export const useCognito = () => useContext(CognitoContext);

function LoginScreen({ onLogin, onCompleteNewPassword }: { onLogin: (u: string, p: string) => Promise<string | null>; onCompleteNewPassword: (newPassword: string) => Promise<string | null> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [challenge, setChallenge] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inputStyle = { width: "100%", padding: "10px", marginBottom: "12px", border: "1px solid #ddd", borderRadius: "6px", boxSizing: "border-box" as const };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    if (challenge) {
      if (newPassword !== confirmPassword) { setError("Passwords do not match"); setLoading(false); return; }
      const err = await onCompleteNewPassword(newPassword);
      if (err) { setError(err); setLoading(false); }
      return;
    }
    const err = await onLogin(username, password);
    if (err === NEW_PASSWORD_REQUIRED) { setChallenge(true); setLoading(false); setError(""); return; }
    if (err) { setError(err); setLoading(false); }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#f8f9fa" }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", padding: "2rem", borderRadius: "12px", boxShadow: "0 2px 12px rgba(0,0,0,0.1)", width: "320px" }}>
        <h2 style={{ textAlign: "center", marginBottom: "1.5rem" }}>StoreAI</h2>
        {challenge ? (
          <>
            <p style={{ fontSize: "13px", color: "#555", margin: "0 0 12px", textAlign: "center" }}>
              First sign-in — please set a new password.
            </p>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" type="password" required style={inputStyle} />
            <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" type="password" required style={inputStyle} />
          </>
        ) : (
          <>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required style={inputStyle} />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" required style={inputStyle} />
          </>
        )}
        {error && <p style={{ color: "#d13212", fontSize: "14px", margin: "0 0 12px" }}>{error}</p>}
        <button type="submit" disabled={loading}
          style={{ width: "100%", padding: "10px", background: "#ff9900", color: "#fff", border: "none", borderRadius: "6px", fontSize: "16px", cursor: "pointer" }}>
          {loading ? (challenge ? "Saving..." : "Signing in...") : (challenge ? "Set Password" : "Sign In")}
        </button>
      </form>
    </div>
  );
}
