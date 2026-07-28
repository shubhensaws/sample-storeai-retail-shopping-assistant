"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import { useToast } from "@/components/Toast";
import * as api from "@/lib/api";
import type { CartItem } from "@/lib/types";

export default function CartPage() {
  const { customer, signOut } = useAuth();
  const { demoMode, boothStation } = useConfig();
  const { toast } = useToast();
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [payment, setPayment] = useState("demo");
  const [checkedOut, setCheckedOut] = useState(false);
  const [qrData, setQrData] = useState<{ qr: string; url: string } | null>(null);
  const imageCache = useRef<Record<string, string>>({});
  const [imageCacheVer, setImageCacheVer] = useState(0);

  const load = () => {
    if (customer) api.getCart(customer.customer_id).then((r) => {
      const cartItems = r.items || [];
      setItems(cartItems);
      // Fetch image_file for each product
      cartItems.forEach((item: any) => {
        const pid = item.product_id;
        if (pid && !imageCache.current[pid]) {
          api.getProduct(pid).then((p) => {
            if (p?.image_file) {
              imageCache.current[pid] = p.image_file;
              setImageCacheVer((v) => v + 1);
            }
          }).catch(() => {});
        }
      });
    }).catch(() => {});
  };
  useEffect(load, [customer]);

  const handleRemove = async (cartItemId: string) => {
    if (!customer) return;
    await api.removeFromCart(customer.customer_id, cartItemId);
    toast("Item removed from cart");
    load();
  };

  const handleCheckout = async () => {
    if (!customer) return;
    // Check if try-on room has items
    try {
      const tryon = await api.getTryOnRoom(customer.customer_id);
      const tryonItems = tryon.items || [];
      if (tryonItems.length > 0) {
        const names = tryonItems.map((i: any) => i.name || i.product_id).join(", ");
        const ok = window.confirm(`You have ${tryonItems.length} item(s) in your Try-On Room (${names}) that won't be included in this order.\n\nProceed with checkout? The Try-On Room will be cleared.`);
        if (!ok) return;
      }
    } catch {}
    await api.checkout(customer.customer_id, true);
    // Generate QR and redirect to checkout page
    let qr = "";
    try {
      const r = await api.generateTryOnQr(customer.customer_id);
      if (r?.qr_code_base64) qr = r.qr_code_base64;
    } catch {}
    const params = new URLSearchParams({ customer: customer.first_name || "", total: total.toFixed(2), items: String(items.length) });
    if (qr) params.set("qr", qr);
    router.push(`/checkout?${params.toString()}`);
    signOut();
  };

  const handleSendToTryon = async () => {
    if (!customer) return;
    await api.updateBoothStatus({ customer_id: customer.customer_id, status: "ready_for_tryon" });
    toast("Head over to the Try-On station!");
  };

  if (!customer) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-light tracking-tight text-[hsl(0,0%,12%)]">Cart</h1>
        <p className="text-sm text-[hsl(0,0%,55%)] mt-4">Sign in via the Shopping Assistant to view your cart.</p>
        <button onClick={() => router.push("/assistant")} className="mt-3 text-sm text-[hsl(0,0%,12%)] underline underline-offset-2 hover:text-[hsl(0,0%,30%)]">Go to Assistant</button>
      </div>
    );
  }

  const subtotal = items.reduce((s, i) => s + i.price * (i.quantity || 1), 0);
  const tax = Math.round(subtotal * 0.08 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  return (
    <div className="max-w-4xl mx-auto" data-img-ver={imageCacheVer}>
      <div className="mb-8">
        <h1 className="text-3xl font-light tracking-tight text-[hsl(0,0%,12%)]">Cart</h1>
        <p className="text-sm text-[hsl(0,0%,55%)] mt-1">{items.length} item{items.length !== 1 ? "s" : ""}</p>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[hsl(0,0%,55%)] text-sm mb-6">Your cart is empty.</p>
          <button onClick={() => router.push("/shop")}
            className="text-sm border border-[hsl(0,0%,12%)] px-6 py-2 rounded-sm hover:bg-[hsl(40,10%,96%)] transition-colors">
            Continue Shopping
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2 space-y-4">
            {items.map((item) => {
              const imgFile = imageCache.current[item.product_id];
              const imgSrc = imgFile ? `/images/${imgFile}` : "";
              return (
                <div key={item.cart_item_id} className="flex gap-4 border-b border-[hsl(0,0%,92%)] pb-4">
                  <div className="w-20 h-24 flex-shrink-0 overflow-hidden rounded-sm bg-[hsl(40,10%,95%)]">
                    {imgSrc ? (
                      <img src={imgSrc} alt={item.product_name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-[10px] text-[hsl(0,0%,65%)]">No image</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[10px] text-[hsl(0,0%,55%)] uppercase tracking-[1.5px]">{item.brand}</p>
                        <h3 className="text-sm font-medium text-[hsl(0,0%,12%)]">{item.product_name}</h3>
                        <p className="text-[11px] text-[hsl(0,0%,55%)] mt-0.5">Size: {item.size} · Qty: {item.quantity || 1}</p>
                      </div>
                      <button onClick={() => handleRemove(item.cart_item_id)}
                        className="text-[hsl(0,0%,65%)] hover:text-[hsl(0,0%,12%)] transition-colors text-lg leading-none">&times;</button>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <button onClick={() => router.push(`/tryon-room?pid=${item.product_id}`)}
                        disabled={demoMode === "booth" && boothStation === "shopping"}
                        title={demoMode === "booth" && boothStation === "shopping" ? "Try-on is available at the Try-On Station" : ""}
                        className={`text-[11px] border border-[hsl(0,0%,85%)] px-3 py-1 rounded-sm transition-colors ${demoMode === "booth" && boothStation === "shopping" ? "opacity-40 cursor-not-allowed" : "hover:border-[hsl(0,0%,60%)]"}`}>
                        Try on
                      </button>
                      <p className="text-sm font-semibold">${(item.price * (item.quantity || 1)).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white border border-[hsl(0,0%,90%)] rounded-sm p-5 h-fit space-y-5">
            <h2 className="text-[11px] font-medium uppercase tracking-[2px] text-[hsl(0,0%,55%)]">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-[hsl(0,0%,55%)]">Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-[hsl(0,0%,55%)]">Tax (8%)</span><span>${tax.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-[hsl(0,0%,92%)] pt-2 font-semibold"><span>Total</span><span>${total.toFixed(2)}</span></div>
            </div>

            {demoMode === "booth" && boothStation === "shopping" ? (
              <div className="relative group">
                <button disabled
                  className="w-full py-2.5 text-sm font-medium tracking-wider uppercase bg-[hsl(0,0%,12%)] text-white rounded-sm opacity-40 cursor-not-allowed">
                  Checkout
                </button>
                <div className="absolute left-0 right-0 top-full mt-1 bg-[hsl(0,0%,12%)] text-white text-[10px] px-3 py-1.5 rounded-sm text-center opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                  Checkout is available at the Try-On Station
                </div>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-[10px] uppercase tracking-[1.5px] text-[hsl(0,0%,55%)] mb-1.5">Payment Method</p>
                  <select value={payment} onChange={(e) => setPayment(e.target.value)}
                    className="w-full text-xs border border-[hsl(0,0%,90%)] rounded-sm px-3 py-1.5 bg-white">
                    <option value="demo">Demo (No Payment)</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="debit_card">Debit Card</option>
                    <option value="upi">UPI</option>
                    <option value="wallet">Digital Wallet</option>
                  </select>
                </div>
                <button onClick={handleCheckout}
                  className="w-full py-2.5 text-sm font-medium tracking-wider uppercase bg-[hsl(0,0%,12%)] text-white rounded-sm hover:bg-[hsl(0,0%,20%)] transition-colors">
                  Checkout
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
