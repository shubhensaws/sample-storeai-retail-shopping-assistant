"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CheckoutContent() {
  const params = useSearchParams();
  const customer = params.get("customer") || "Guest";
  const total = params.get("total") || "0.00";
  const itemCount = params.get("items") || "0";
  const qr = params.get("qr");

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      {/* Order confirmation */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-[hsl(142,71%,95%)] flex items-center justify-center mx-auto mb-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="hsl(142,71%,45%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-light tracking-tight text-[hsl(0,0%,12%)]">Order Confirmed!</h1>
        <p className="text-sm text-[hsl(0,0%,55%)] mt-2">Thank you, {customer}!</p>
      </div>

      {/* Order summary */}
      <div className="bg-[hsl(40,10%,97%)] rounded-lg p-5 mb-6">
        <h2 className="text-[10px] uppercase tracking-[2px] text-[hsl(0,0%,55%)] font-medium mb-3">Order Summary</h2>
        <div className="flex justify-between text-sm text-[hsl(0,0%,30%)] mb-1">
          <span>{itemCount} item{itemCount !== "1" ? "s" : ""}</span>
          <span>${total}</span>
        </div>
        <div className="border-t border-[hsl(0,0%,90%)] mt-2 pt-2 flex justify-between text-sm font-medium">
          <span>Payment</span>
          <span className="text-[hsl(142,71%,40%)]">Demo — No payment required</span>
        </div>
      </div>

      {/* Demo notice */}
      <div className="bg-[hsl(45,100%,96%)] border border-[hsl(45,100%,85%)] rounded-lg p-4 mb-6">
        <p className="text-sm text-[hsl(45,80%,30%)]">
          This is a demo — no actual payment or delivery. StoreAI demonstrates how a <strong>Flexible AI Architecture</strong> using <strong>AWS AI Chips and Services</strong> can transform the retail shopping experience.
        </p>
      </div>

      {/* QR Code */}
      {qr && (
        <div className="text-center mb-6">
          <div className="bg-white rounded-lg p-6 inline-block shadow-sm border border-[hsl(0,0%,92%)]">
            <img src={`data:image/png;base64,${qr}`} alt="QR Code" className="w-52 h-52 mx-auto mb-3" />
            <p className="text-sm font-medium text-[hsl(0,0%,30%)]">Scan to download your try-on photos</p>
            <p className="text-[10px] text-[hsl(0,0%,55%)] mt-1">One-time link — scan now before leaving</p>
          </div>
        </div>
      )}

      {/* What's next */}
      <div className="bg-[hsl(210,50%,97%)] border border-[hsl(210,50%,90%)] rounded-lg p-5 mb-6">
        <h2 className="text-sm font-medium text-[hsl(210,50%,30%)] mb-2">What's next?</h2>
        <p className="text-sm text-[hsl(0,0%,45%)] leading-relaxed">
          Head over to the <strong>Presentation Station</strong> to learn about the architecture behind StoreAI — how it's built using a <strong>Flexible AI Architecture</strong> with <strong>AWS AI Chips and Services</strong> including AWS Trainium2, Graviton, Amazon Bedrock, Amazon Nova, and more.
        </p>
      </div>

      {/* Branding */}
      <div className="text-center text-[10px] text-[hsl(0,0%,65%)] mt-8">
        <span className="text-[hsl(30,100%,50%)] font-medium">StoreAI</span> · AWS Summit Bengaluru 2026
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return <Suspense fallback={<div className="max-w-lg mx-auto py-12 text-center text-sm text-[hsl(0,0%,55%)]">Loading...</div>}><CheckoutContent /></Suspense>;
}
