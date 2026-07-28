"use client";
import { AuthProvider } from "@/context/AuthContext";
import { ConfigProvider } from "@/context/ConfigContext";
import { CognitoAuthProvider } from "@/context/CognitoAuthContext";
import { ToastProvider } from "@/components/Toast";
import { useConfig } from "@/context/ConfigContext";
import Sidebar from "@/components/Sidebar";

function Inner({ children }: { children: React.ReactNode }) {
  const { sidebarOpen } = useConfig();
  return (
    <div className="flex min-h-screen bg-[hsl(40,20%,98%)]">
      <Sidebar />
      <main className={`flex-1 p-6 transition-all ${sidebarOpen ? "ml-56" : "ml-8"}`}>{children}</main>
    </div>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <CognitoAuthProvider>
      <AuthProvider>
        <ConfigProvider>
          <ToastProvider>
            <Inner>{children}</Inner>
          </ToastProvider>
        </ConfigProvider>
      </AuthProvider>
    </CognitoAuthProvider>
  );
}
