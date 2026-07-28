"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import { useToast } from "@/components/Toast";
import CameraCapture from "@/components/CameraCapture";
import * as api from "@/lib/api";
import type { TryOnRoomItem, BoothQueueItem, CartItem, Product } from "@/lib/types";

const GARMENT_MAP: Record<string, string> = {
  mens_tshirt: "UPPER_BODY", mens_polo: "UPPER_BODY", mens_shirt: "UPPER_BODY", mens_hoodie: "UPPER_BODY", mens_jacket: "UPPER_BODY", mens_sweater: "UPPER_BODY",
  womens_tshirt: "UPPER_BODY", womens_blouse: "UPPER_BODY", womens_croptop: "UPPER_BODY", womens_hoodie: "UPPER_BODY", womens_cardigan: "UPPER_BODY",
  mens_jeans: "LOWER_BODY", mens_chinos: "LOWER_BODY", mens_shorts: "LOWER_BODY", mens_joggers: "LOWER_BODY",
  womens_jeans: "LOWER_BODY", womens_skirt: "LOWER_BODY", womens_shorts: "LOWER_BODY", womens_leggings: "LOWER_BODY",
  womens_dress: "FULL_BODY",
  sneakers: "FOOTWEAR", running_shoes: "FOOTWEAR", loafers: "FOOTWEAR", boots: "FOOTWEAR", sandals: "FOOTWEAR", slippers: "FOOTWEAR",
};

export default function TryOnRoomPage() {
  return <Suspense><TryOnRoomInner /></Suspense>;
}

function TryOnRoomInner() {
  const { customer, setCustomer } = useAuth();
  const { vtonEngine, vtonSteps, vtonCfgScale, vtonSeed, demoMode, boothStation, debugMode } = useConfig();
  const tryonDisabled = demoMode === "booth" && boothStation === "shopping";
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState<TryOnRoomItem[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [queue, setQueue] = useState<BoothQueueItem[]>([]);
  // Try-on workspace state
  const [selectedPid, setSelectedPid] = useState(params.get("pid") || "");
  const [photoPreview, setPhotoPreview] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [tryonLoading, setTryonLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  // Size rec
  const [sizeRec, setSizeRec] = useState<any>(null);
  const [sizeHeight, setSizeHeight] = useState(165);
  const [sizeGender, setSizeGender] = useState("women");
  const [cartSize, setCartSize] = useState("");
  const [cartSizes, setCartSizes] = useState<Record<string, string>>({});
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [qrData, setQrData] = useState<{ qr: string; url: string } | null>(null);

  const load = () => {
    if (!customer) return;
    api.getTryOnRoom(customer.customer_id).then((r) => {
      const itms = r.items || [];
      setItems(itms);
      itms.forEach((it: TryOnRoomItem) => {
        if (!products[it.product_id]) {
          api.getProduct(it.product_id).then((p: Product) => {
            setProducts((prev) => ({ ...prev, [it.product_id]: p }));
          }).catch(() => {});
        }
      });
    }).catch(() => {});
    api.getCart(customer.customer_id).then((r) => {
      const ci = r.items || [];
      setCartItems(ci);
      ci.forEach((it: any) => {
        if (!products[it.product_id]) {
          api.getProduct(it.product_id).then((p: Product) => {
            setProducts((prev) => ({ ...prev, [it.product_id]: p }));
          }).catch(() => {});
        }
      });
    }).catch(() => {});
  };
  useEffect(load, [customer]);

  useEffect(() => {
    if (demoMode !== "booth" || boothStation !== "tryon") return;
    const fetch = () => api.getBoothQueue().then((r) => setQueue(r.queue || [])).catch(() => {});
    fetch();
    const id = setInterval(fetch, 20000);
    return () => clearInterval(id);
  }, [demoMode, boothStation]);

  // Load product when selected
  useEffect(() => {
    if (!selectedPid) return;
    if (!products[selectedPid]) {
      api.getProduct(selectedPid).then((p) => setProducts((prev) => ({ ...prev, [selectedPid]: p }))).catch(() => {});
    }
    setResultUrl("");
    setSizeRec(null);
  }, [selectedPid]);

  const selectedProduct = products[selectedPid] || null;

  const handleRemove = async (productId: string) => {
    if (!customer) return;
    await api.removeFromTryOnRoom(customer.customer_id, productId);
    if (selectedPid === productId) { setSelectedPid(""); setResultUrl(""); }
    toast("Removed from try-on room");
    load();
  };

  const handleAddToCartFromList = async (productId: string) => {
    if (!customer) return;
    const size = cartSizes[productId];
    if (!size) { toast("Select a size first", "info"); return; }
    await api.addToCart(customer.customer_id, { product_id: productId, size });
    await api.removeFromTryOnRoom(customer.customer_id, productId);
    toast(`Added to cart (${size})`);
    load();
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !customer) return;
    setPhotoPreview(URL.createObjectURL(file));
    const b64 = await new Promise<string>((r) => { const rd = new FileReader(); rd.onload = () => r((rd.result as string).split(",")[1]); rd.readAsDataURL(file); });
    await api.uploadTryonPhoto({ customer_id: customer.customer_id, photo_base64: b64 }).catch(() => {});
    toast("Photo uploaded");
  };

  const handleCameraCapture = async (base64: string) => {
    setShowCamera(false);
    if (!customer) return;
    setPhotoPreview(`data:image/png;base64,${base64}`);
    await api.uploadTryonPhoto({ customer_id: customer.customer_id, photo_base64: base64 });
    toast("Photo captured");
    // Auto-run try-on if a product is selected
    if (selectedPid) runTryOn(base64);
  };

  const runTryOn = async (preUploadedB64?: string) => {
    if (!customer || !selectedPid) return;
    setTryonLoading(true);
    setResultUrl("");
    try {
      if (!preUploadedB64 && !photoPreview) {
        // No photo — open camera
        setShowCamera(true);
        setTryonLoading(false);
        return;
      }
      const r = await api.generateTryOn(customer.customer_id, { product_id: selectedPid, engine: vtonEngine, ...(vtonEngine === "qwen_image_edit" ? { vton_steps: vtonSteps, vton_cfg_scale: vtonCfgScale, vton_seed: vtonSeed } : {}) });
      if (r?.result_url) setResultUrl(r.result_url);
      else if (r?.result_image) setResultUrl(`data:image/png;base64,${r.result_image}`);
      else if (r?.error === "content_review") toast(r.message || "This try-on couldn't be completed for this item.", "error");
      else toast("Try-on didn't return an image", "error");
      // Run photo-based size recommendation
      try {
        const sr = await api.photoSizeRecommendation({ customer_id: customer.customer_id, product_id: selectedPid, marker_color: "red", marker_height_cm: 100 });
        if (sr?.recommended_size) { setSizeRec(sr); setCartSize(sr.recommended_size); }
      } catch {}
    } catch (e: any) {
      if (e.message?.toLowerCase().includes("no photo")) {
        setShowCamera(true);
      } else {
        toast(`Try-on failed: ${e.message}`, "error");
      }
    } finally { setTryonLoading(false); }
  };

  const handleGetSize = async () => {
    if (!selectedPid || !customer) return;
    const ratios = sizeGender === "men"
      ? { chest: 0.57, waist: 0.48, hip: 0.56, shoulder_width: 0.27, arm_length: 0.36, shirt_length: 0.42, thigh_circumference: 0.34, trouser_length: 0.59, neck: 0.23 }
      : { chest: 0.54, waist: 0.44, hip: 0.58, shoulder_width: 0.24, arm_length: 0.34, shirt_length: 0.39, thigh_circumference: 0.35, trouser_length: 0.56, neck: 0.21 };
    const est = Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, Math.round(sizeHeight * v * 10) / 10]));
    try {
      await api.saveMeasurements({ customer_id: customer.customer_id, measurements: est, source: "height_estimate" });
      const rec = await api.recommendSize(customer.customer_id, selectedPid);
      setSizeRec(rec);
      if (rec?.recommended_size) setCartSize(rec.recommended_size);
    } catch {}
  };

  const handleAddToCartFromWorkspace = async () => {
    if (!customer || !selectedPid || !cartSize) { toast("Select a size first", "info"); return; }
    await api.addToCart(customer.customer_id, { product_id: selectedPid, size: cartSize });
    await api.removeFromTryOnRoom(customer.customer_id, selectedPid).catch(() => {});
    toast(`Added to cart (${cartSize})`);
    setSelectedPid("");
    setResultUrl("");
    load();
  };

  if (!customer) {
    return (
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-light tracking-tight text-[hsl(0,0%,12%)]">Try-On Room</h1>
        <p className="text-sm text-[hsl(0,0%,55%)] mt-4">Sign in via the Shopping Assistant to use the Try-On Room.</p>
        <button onClick={() => router.push("/assistant")} className="mt-3 text-sm text-[hsl(0,0%,12%)] underline underline-offset-2">Go to Assistant</button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-light tracking-tight text-[hsl(0,0%,12%)]">Try-On Room</h1>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm text-[hsl(0,0%,55%)]">Try on items and pick your size</p>
          {tryonDisabled && customer && (items.length > 0 || cartItems.length > 0) && (
            <button onClick={async () => {
              await api.updateBoothStatus({ customer_id: customer.customer_id, status: "ready_for_tryon" });
              toast("You're in the queue! Head to the Try-On Station.");
              setCustomer(null);
            }} className="text-xs bg-[hsl(0,0%,12%)] text-white px-4 py-2 rounded-sm hover:bg-[hsl(0,0%,20%)] transition-colors">
              Send to Try-On Station
            </button>
          )}
        </div>
      </div>

      {/* Booth queue */}
      {demoMode === "booth" && boothStation === "tryon" && (
        <div className="mb-6 p-4 border border-[hsl(0,0%,90%)] rounded-sm bg-white">
          <h3 className="text-[11px] uppercase tracking-[2px] text-[hsl(0,0%,55%)] font-medium mb-3">Customer Queue</h3>
          {queue.length > 0 ? (
            <div className="flex flex-col gap-2">
              {queue.map((q) => (
                <div key={q.customer_id} className="flex items-center justify-between text-sm">
                  <span>{q.first_name} {q.last_name} ({q.phone}) — {q.total_items} items</span>
                  <button onClick={async () => {
                    const c = await api.signIn({ customer_id: q.customer_id }).catch(() => null);
                    if (c?.customer_id) { setCustomer(c); api.updateBoothStatus({ customer_id: q.customer_id, status: "trying_on" }); load(); }
                  }} className="text-[11px] bg-[hsl(0,0%,12%)] text-white px-3 py-1 rounded-sm">Start</button>
                </div>
              ))}
              <button onClick={() => api.getBoothQueue().then((r) => setQueue(r.queue || []))}
                className="text-[11px] text-[hsl(0,0%,55%)] hover:text-[hsl(0,0%,12%)] self-start mt-1">Refresh queue</button>
            </div>
          ) : <p className="text-xs text-[hsl(0,0%,55%)]">No customers in queue yet.</p>}
        </div>
      )}

      {/* Items list */}
      {items.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[11px] uppercase tracking-[2px] text-[hsl(0,0%,55%)] font-medium border-b border-[hsl(0,0%,90%)] pb-2 mb-4">Your Items</h3>
          <div className="flex flex-col gap-3">
            {items.map((item) => {
              const prod = products[item.product_id];
              const sizes = prod ? (Array.isArray(prod.sizes) ? prod.sizes : Object.keys(prod.sizes || {})) : [];
              const imgSrc = prod?.image_url || (prod?.image_file ? `/images/${prod.image_file}` : "");
              const isSelected = selectedPid === item.product_id;

              return (
                <div key={item.product_id} className={`flex items-center gap-4 border rounded-sm p-3 bg-white transition-colors ${isSelected ? "border-[hsl(0,0%,12%)]" : "border-[hsl(0,0%,90%)]"}`}>
                  {imgSrc && <img src={imgSrc} alt={item.product_name} className="w-16 h-20 object-cover rounded-sm bg-[hsl(40,10%,95%)]" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-[1px] text-[hsl(0,0%,55%)]">{prod?.brand}</div>
                    <div className="text-sm font-medium text-[hsl(0,0%,12%)]">{item.product_name}</div>
                    <div className="text-[11px] text-[hsl(0,0%,55%)]">${prod?.price != null ? (Number(prod.price) || 0).toFixed(2) : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedPid(isSelected ? "" : item.product_id)}
                      disabled={tryonDisabled}
                      title={tryonDisabled ? "Try-on is available at the Try-On Station" : ""}
                      className={`text-[11px] px-3 py-1.5 rounded-sm transition-colors ${tryonDisabled ? "opacity-40 cursor-not-allowed border border-[hsl(0,0%,85%)]" : isSelected ? "bg-[hsl(0,0%,12%)] text-white" : "border border-[hsl(0,0%,85%)] hover:border-[hsl(0,0%,60%)]"}`}>
                      {isSelected ? "Selected" : "Try on"}
                    </button>

                    {item.source === "tryon" && sizes.length > 0 && (
                      <div className="flex gap-1">
                        <select value={cartSizes[item.product_id] || ""} onChange={(e) => setCartSizes((p) => ({ ...p, [item.product_id]: e.target.value }))}
                          className="text-[11px] border border-[hsl(0,0%,90%)] rounded-sm px-1.5 py-1">
                          <option value="">Size</option>
                          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button onClick={() => handleAddToCartFromList(item.product_id)}
                          className="text-[11px] bg-[hsl(0,0%,12%)] text-white px-2 py-1 rounded-sm">Cart</button>
                      </div>
                    )}

                    <button onClick={() => handleRemove(item.product_id)}
                      className="text-[hsl(0,0%,65%)] hover:text-[hsl(0,72%,51%)] text-lg leading-none">&times;</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {items.length === 0 && cartItems.length === 0 && !selectedPid && (
        <div className="text-center py-16">
          <p className="text-[hsl(0,0%,55%)] text-sm mb-6">Your try-on room is empty. Add items from the Shop or via the Assistant.</p>
          <button onClick={() => router.push("/shop")}
            className="text-sm border border-[hsl(0,0%,12%)] px-6 py-2 rounded-sm hover:bg-[hsl(40,10%,96%)] transition-colors">
            Browse Shop
          </button>
        </div>
      )}

      {/* Try-on workspace — shown when a product is selected */}
      {selectedPid && selectedProduct && (
        <div className="border border-[hsl(0,0%,90%)] rounded-sm bg-white p-5 mb-6">
          <div className="text-[11px] uppercase tracking-[2px] text-[hsl(0,0%,55%)] font-medium border-b border-[hsl(0,0%,92%)] pb-2 mb-4">
            Try on: {selectedProduct.name}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Product image */}
            <div>
              <p className="text-[11px] text-[hsl(0,0%,55%)] mb-2">Product</p>
              {(selectedProduct.image_url || selectedProduct.image_file) && (
                <img src={selectedProduct.image_url || `/images/${selectedProduct.image_file}`}
                  alt={selectedProduct.name} className="w-full max-h-72 object-cover rounded-sm cursor-pointer hover:opacity-90"
                  onClick={() => setZoomImg(selectedProduct.image_url || `/images/${selectedProduct.image_file}`)} />
              )}
            </div>

            {/* Photo + controls */}
            <div>
              <p className="text-[11px] text-[hsl(0,0%,55%)] mb-2">Your Photo</p>
              <div className="flex gap-2 mb-3">
                <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-[hsl(0,0%,85%)] rounded-sm cursor-pointer hover:border-[hsl(0,0%,60%)] transition-colors text-[11px] text-[hsl(0,0%,30%)]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
                  Upload
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                </label>
                <button onClick={() => setShowCamera(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-[hsl(0,0%,85%)] rounded-sm hover:border-[hsl(0,0%,60%)] transition-colors text-[11px] text-[hsl(0,0%,30%)]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3" /></svg>
                  Camera
                </button>
              </div>
              {photoPreview && <img src={photoPreview} alt="Your photo" className="max-h-48 rounded-sm mb-3" />}

              <button onClick={() => runTryOn()} disabled={tryonLoading}
                className="w-full text-[11px] bg-[hsl(0,0%,12%)] text-white py-2.5 rounded-sm hover:bg-[hsl(0,0%,20%)] disabled:opacity-40 transition-colors tracking-wider uppercase">
                {tryonLoading ? "Generating..." : "Try it on"}
              </button>
            </div>

            {/* Result */}
            <div>
              <p className="text-[11px] text-[hsl(0,0%,55%)] mb-2">Result</p>
              {tryonLoading ? (
                <div className="flex items-center justify-center h-48">
                  <span className="text-sm text-[hsl(0,0%,55%)] animate-pulse">Generating... (10-25s)</span>
                </div>
              ) : resultUrl ? (
                <>
                <img src={resultUrl} alt="Try-on result" className="max-h-72 rounded-sm cursor-pointer hover:opacity-90"
                  onClick={() => setZoomImg(resultUrl)} />
                {sizeRec?.recommended_size && (
                  <p className="text-[11px] text-[hsl(142,71%,35%)] mt-2">Recommended size: <strong>{sizeRec.recommended_size}</strong></p>
                )}
                </>
              ) : (
                <div className="flex items-center justify-center h-48 text-xs text-[hsl(0,0%,60%)]">
                  Upload or capture your photo, then click "Try it on"
                </div>
              )}
            </div>
          </div>

          {/* Size recommendation — hidden by default, toggle in More Options */}
          {debugMode && (
          <div className="border-t border-[hsl(0,0%,92%)] mt-5 pt-4">
            <p className="text-[11px] uppercase tracking-[2px] text-[hsl(0,0%,55%)] font-medium mb-3">Size Recommendation</p>
            {sizeRec ? (
              <div className="text-sm">
                <span className="font-medium">{sizeRec.recommendation}</span>
                {sizeRec.alternative && <span className="text-xs text-[hsl(0,0%,55%)] ml-2">{sizeRec.alternative.note}</span>}
              </div>
            ) : (
              <div className="flex gap-2 items-end">
                <div>
                  <label className="text-[10px] text-[hsl(0,0%,55%)] block">Height (cm)</label>
                  <input type="number" value={sizeHeight} onChange={(e) => setSizeHeight(Number(e.target.value))} className="w-20 text-xs border border-[hsl(0,0%,90%)] rounded-sm px-2 py-1" />
                </div>
                <div>
                  <label className="text-[10px] text-[hsl(0,0%,55%)] block">Gender</label>
                  <select value={sizeGender} onChange={(e) => setSizeGender(e.target.value)} className="text-xs border border-[hsl(0,0%,90%)] rounded-sm px-2 py-1">
                    <option value="women">Women</option><option value="men">Men</option>
                  </select>
                </div>
                <button onClick={handleGetSize} className="text-xs bg-[hsl(0,0%,12%)] text-white px-3 py-1 rounded-sm hover:bg-[hsl(0,0%,20%)]">Get my size</button>
              </div>
            )}
          </div>
          )}

          {/* Add to cart from workspace */}
          {items.some((it) => it.product_id === selectedPid && it.source === "tryon") && (
            <div className="border-t border-[hsl(0,0%,92%)] mt-4 pt-4">
              <p className="text-[11px] uppercase tracking-[2px] text-[hsl(0,0%,55%)] font-medium mb-3">Add to Cart</p>
              <div className="flex gap-2 items-end">
                <div>
                  <label className="text-[10px] text-[hsl(0,0%,55%)] block">Size</label>
                  <select value={cartSize} onChange={(e) => setCartSize(e.target.value)} className="text-xs border border-[hsl(0,0%,90%)] rounded-sm px-2 py-1">
                    <option value="">Select</option>
                    {(Array.isArray(selectedProduct.sizes) ? selectedProduct.sizes : Object.keys(selectedProduct.sizes || {})).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <button onClick={handleAddToCartFromWorkspace}
                  className="text-xs bg-[hsl(0,0%,12%)] text-white px-4 py-1.5 rounded-sm hover:bg-[hsl(0,0%,20%)]">Add to Cart</button>
              </div>
              {sizeRec?.recommended_size && cartSize === sizeRec.recommended_size && (
                <p className="text-[10px] text-[hsl(142,71%,35%)] mt-1.5">Based on your body measurements, we recommend size {sizeRec.recommended_size}. Adjust to your preference.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Checkout */}
      {cartItems.length > 0 && (
        <div className="mb-6 border border-[hsl(0,0%,90%)] rounded-sm bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[11px] uppercase tracking-[2px] text-[hsl(0,0%,55%)] font-medium">Checkout</h3>
              <p className="text-sm text-[hsl(0,0%,40%)] mt-1">
                {cartItems.length} item{cartItems.length > 1 ? "s" : ""} · Total: ${cartItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0).toFixed(2)}
              </p>
            </div>
            <button
              onClick={async () => {
                if (!customer) return;
                try {
                  await api.checkout(customer.customer_id);
                  toast("Checkout complete!");
                  // Generate QR code
                  const qr = await api.generateTryOnQr(customer.customer_id).catch(() => null);
                  if (qr?.qr_code_base64) {
                    setQrData({ qr: qr.qr_code_base64, url: qr.share_url || "" });
                  }
                  load();
                } catch (e: any) {
                  toast(`Checkout failed: ${e.message}`, "error");
                }
              }}
              className="text-sm bg-[hsl(0,0%,12%)] text-white px-6 py-2.5 rounded-sm hover:bg-[hsl(0,0%,20%)] transition-colors tracking-wider uppercase"
            >
              Checkout
            </button>
          </div>
          {qrData && (
            <div className="mt-4 pt-4 border-t border-[hsl(0,0%,92%)] text-center">
              <p className="text-sm text-[hsl(0,0%,40%)] mb-3">Scan to save your try-on photos:</p>
              <img src={`data:image/png;base64,${qrData.qr}`} alt="QR Code" className="w-48 mx-auto" />
              <p className="text-[11px] text-[hsl(0,0%,55%)] mt-2">Thank you for shopping with StoreAI!</p>
            </div>
          )}
        </div>
      )}

      {/* Cart items */}
      {cartItems.length > 0 && (
        <div>
          <h3 className="text-[11px] uppercase tracking-[2px] text-[hsl(0,0%,55%)] font-medium border-b border-[hsl(0,0%,90%)] pb-2 mb-4">Items in Cart</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {cartItems.map((item) => {
              const prod = products[item.product_id];
              const imgSrc = prod?.image_url || (prod?.image_file ? `/images/${prod.image_file}` : "");
              return (
              <div key={item.cart_item_id} className="border border-[hsl(0,0%,90%)] rounded-sm p-3 bg-white">
                {imgSrc && <img src={imgSrc} alt={item.product_name} className="w-full h-24 object-cover rounded-sm mb-2 bg-[hsl(40,10%,95%)]" />}
                <div className="text-[10px] uppercase tracking-[1px] text-[hsl(0,0%,55%)]">{item.brand}</div>
                <div className="text-xs font-medium truncate mt-0.5">{item.product_name}</div>
                <div className="text-[10px] text-[hsl(0,0%,55%)] mt-0.5">${(Number(item.price) || 0).toFixed(2)} · {item.size}</div>
                <button onClick={() => setSelectedPid(item.product_id)}
                  disabled={tryonDisabled}
                  title={tryonDisabled ? "Try-on is available at the Try-On Station" : ""}
                  className={`mt-2 text-[11px] w-full py-1 rounded-sm transition-colors ${tryonDisabled ? "opacity-40 cursor-not-allowed border border-[hsl(0,0%,85%)]" : selectedPid === item.product_id ? "bg-[hsl(0,0%,12%)] text-white" : "border border-[hsl(0,0%,85%)] hover:border-[hsl(0,0%,60%)]"}`}>
                  {selectedPid === item.product_id ? "Selected" : "Try on"}
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Camera overlay */}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
          autoCapture={true}
          countdownSeconds={10}
        />
      )}

      {/* Image zoom modal */}
      {zoomImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setZoomImg(null)}>
          <img src={zoomImg} alt="Zoomed" className="max-w-[90vw] max-h-[90vh] object-contain rounded-sm" />
          <button onClick={() => setZoomImg(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl w-10 h-10 flex items-center justify-center rounded-full bg-black/30">×</button>
        </div>
      )}
    </div>
  );
}
