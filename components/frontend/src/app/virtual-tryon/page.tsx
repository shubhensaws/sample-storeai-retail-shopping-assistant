"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import * as api from "@/lib/api";
import type { Product, TryOnRoomItem, CartItem } from "@/lib/types";

const GARMENT_MAP: Record<string, string> = {
  mens_tshirt: "UPPER_BODY", mens_polo: "UPPER_BODY", mens_shirt: "UPPER_BODY", mens_hoodie: "UPPER_BODY", mens_jacket: "UPPER_BODY", mens_sweater: "UPPER_BODY",
  womens_tshirt: "UPPER_BODY", womens_blouse: "UPPER_BODY", womens_croptop: "UPPER_BODY", womens_hoodie: "UPPER_BODY", womens_cardigan: "UPPER_BODY",
  mens_jeans: "LOWER_BODY", mens_chinos: "LOWER_BODY", mens_shorts: "LOWER_BODY", mens_joggers: "LOWER_BODY",
  womens_jeans: "LOWER_BODY", womens_skirt: "LOWER_BODY", womens_shorts: "LOWER_BODY", womens_leggings: "LOWER_BODY",
  womens_dress: "FULL_BODY",
  sneakers: "FOOTWEAR", running_shoes: "FOOTWEAR", loafers: "FOOTWEAR", boots: "FOOTWEAR", sandals: "FOOTWEAR", slippers: "FOOTWEAR",
};

export default function VirtualTryOnPage() {
  return <Suspense><VirtualTryOnInner /></Suspense>;
}

function VirtualTryOnInner() {
  const { customer, setCustomer } = useAuth();
  const { vtonEngine, vtonSteps, vtonCfgScale, vtonSeed, demoMode, boothStation } = useConfig();
  const router = useRouter();
  const params = useSearchParams();
  const [tryOnItems, setTryOnItems] = useState<TryOnRoomItem[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedPid, setSelectedPid] = useState(params.get("pid") || "");
  const [product, setProduct] = useState<Product | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [garmentClass, setGarmentClass] = useState("UPPER_BODY");
  const [resultUrl, setResultUrl] = useState("");
  const [loading, setLoading] = useState(false);
  // Size rec
  const [sizeRec, setSizeRec] = useState<any>(null);
  const [sizeHeight, setSizeHeight] = useState(165);
  const [sizeGender, setSizeGender] = useState("women");
  const [cartSize, setCartSize] = useState("");
  const [boothQueue, setBoothQueue] = useState<any[]>([]);

  // Load booth queue
  useEffect(() => {
    if (demoMode !== "booth" || boothStation !== "tryon") return;
    const fetch = () => api.getBoothQueue().then((r) => setBoothQueue(r.queue || [])).catch(() => {});
    fetch();
    const id = setInterval(fetch, 20000);
    return () => clearInterval(id);
  }, [demoMode, boothStation]);

  // Load try-on room + cart
  useEffect(() => {
    if (!customer) return;
    api.getTryOnRoom(customer.customer_id).then((r) => setTryOnItems(r.items || [])).catch(() => {});
    api.getCart(customer.customer_id).then((r) => setCartItems(r.items || [])).catch(() => {});
  }, [customer]);

  // Load product details when selected
  useEffect(() => {
    if (!selectedPid) { setProduct(null); return; }
    api.getProduct(selectedPid).then((p) => {
      setProduct(p);
      setGarmentClass(GARMENT_MAP[p.category] || "UPPER_BODY");
    }).catch(() => {});
    setResultUrl("");
    setSizeRec(null);
  }, [selectedPid]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    // Also upload to S3 for agent-driven try-on
    if (customer) {
      const b64 = await new Promise<string>((r) => { const rd = new FileReader(); rd.onload = () => r((rd.result as string).split(",")[1]); rd.readAsDataURL(file); });
      api.uploadTryonPhoto({ customer_id: customer.customer_id, photo_base64: b64 }).catch(() => {});
    }
  };

  const handleTryOn = async () => {
    if (!customer || !selectedPid || !photo) return;
    setLoading(true);
    setResultUrl("");
    try {
      // Upload photo
      const b64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(photo);
      });
      await api.uploadTryonPhoto({ customer_id: customer.customer_id, photo_base64: b64 });
      // Generate try-on
      const r = await api.generateTryOn(customer.customer_id, { product_id: selectedPid, engine: vtonEngine, ...(vtonEngine === "qwen_image_edit" ? { vton_steps: vtonSteps, vton_cfg_scale: vtonCfgScale, vton_seed: vtonSeed } : {}) });
      if (r?.result_url) setResultUrl(r.result_url);
      else if (r?.result_image) setResultUrl(`data:image/png;base64,${r.result_image}`);
      else if (r?.error === "content_review") alert(r.message || "This try-on couldn't be completed for this item. Try a different photo.");
      else alert("Try-on did not return an image. Try a different photo.");
    } catch (e: any) {
      alert(`Try-on failed: ${e.message}`);
    } finally { setLoading(false); }
  };

  const handleGetSize = async () => {
    if (!selectedPid || !customer) return;
    const g = sizeGender;
    const h = sizeHeight;
    const ratios = g === "men"
      ? { chest: 0.57, waist: 0.48, hip: 0.56, shoulder_width: 0.27, arm_length: 0.36, shirt_length: 0.42, thigh_circumference: 0.34, trouser_length: 0.59, neck: 0.23 }
      : { chest: 0.54, waist: 0.44, hip: 0.58, shoulder_width: 0.24, arm_length: 0.34, shirt_length: 0.39, thigh_circumference: 0.35, trouser_length: 0.56, neck: 0.21 };
    const est = Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, Math.round(h * v * 10) / 10]));
    try {
      await api.saveMeasurements({ customer_id: customer.customer_id, measurements: est, source: "height_estimate" });
      const rec = await api.recommendSize(customer.customer_id, selectedPid);
      setSizeRec(rec);
      if (rec?.recommended_size) setCartSize(rec.recommended_size);
    } catch {}
  };

  const handleAddToCart = async () => {
    if (!customer || !selectedPid || !cartSize) return alert("Select a size first");
    await api.addToCart(customer.customer_id, { product_id: selectedPid, size: cartSize });
    await api.removeFromTryOnRoom(customer.customer_id, selectedPid).catch(() => {});
    alert(`Added to cart (${cartSize})!`);
    // Refresh
    api.getTryOnRoom(customer.customer_id).then((r) => setTryOnItems(r.items || [])).catch(() => {});
    api.getCart(customer.customer_id).then((r) => setCartItems(r.items || [])).catch(() => {});
  };

  if (!customer) {
    return (
      <div>
        <h1 className="text-3xl font-light tracking-tight text-[hsl(0,0%,12%)]">Virtual Try-On</h1>
        <p className="text-sm text-[hsl(0,0%,55%)] mt-4">Sign in via the Shopping Assistant to use Virtual Try-On.</p>
        <button onClick={() => router.push("/assistant")} className="mt-3 text-sm text-[hsl(0,0%,12%)] underline underline-offset-2 hover:text-[hsl(0,0%,30%)]">Go to Assistant</button>
      </div>
    );
  }

  const productImg = product?.image_url || (product?.image_file ? `/images/${product.image_file}` : "");

  return (
    <div>
      <h1 className="text-3xl font-light tracking-tight">Virtual Try-On</h1>
      <p className="text-sm text-gray-400 mb-6">See how items look on you</p>

      {/* Booth queue */}
      {demoMode === "booth" && boothStation === "tryon" && (
        <div className="mb-8 border border-[hsl(0,0%,90%)] rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[2px] text-[hsl(0,0%,55%)]">Try-On Queue</h3>
            <button onClick={() => api.getBoothQueue().then((r) => setBoothQueue(r.queue || []))}
              className="text-[11px] text-[hsl(0,0%,55%)] hover:text-[hsl(0,0%,12%)] transition-colors">Refresh</button>
          </div>
          {boothQueue.length > 0 ? (
            <div className="flex flex-col gap-2">
              {boothQueue.map((q) => (
                <div key={q.customer_id} className="flex items-center justify-between py-2 border-b border-[hsl(0,0%,95%)] last:border-0">
                  <div>
                    <span className="text-sm text-[hsl(0,0%,12%)]">{q.first_name} {q.last_name}</span>
                    <span className="text-xs text-[hsl(0,0%,55%)] ml-2">{q.phone} · {q.total_items} items</span>
                  </div>
                  <button onClick={async () => {
                    const c = await api.signIn({ customer_id: q.customer_id }).catch(() => null);
                    if (c?.customer_id) { setCustomer(c); api.updateBoothStatus({ customer_id: q.customer_id, status: "trying_on" }); }
                  }} className="text-xs bg-[hsl(0,0%,12%)] text-white px-3 py-1 rounded-sm hover:bg-[hsl(0,0%,20%)] transition-colors">Start</button>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-[hsl(0,0%,55%)]">No customers in queue yet.</p>}
        </div>
      )}

      {/* Try-On Room items */}
      {tryOnItems.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs uppercase tracking-widest text-gray-400 font-medium mb-2">Your Try-On Room</h3>
          <div className="flex gap-2 flex-wrap">
            {tryOnItems.map((it) => (
              <button key={it.product_id} onClick={() => setSelectedPid(it.product_id)}
                className={`text-xs border px-3 py-1.5 rounded ${selectedPid === it.product_id ? "bg-black text-white" : "hover:bg-gray-50"}`}>
                {it.product_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Try-on workspace */}
      {selectedPid && product ? (
        <>
          <div className="text-xs uppercase tracking-widest text-gray-400 font-medium border-b pb-2 mb-4">
            Try on: {product.name}
          </div>
          <div className="grid grid-cols-3 gap-6">
            {/* Product */}
            <div>
              <h3 className="text-xs text-gray-500 mb-2">Product</h3>
              {productImg && <img src={productImg} alt={product.name} className="w-full max-h-72 object-cover rounded" />}
            </div>

            {/* Photo + controls */}
            <div>
              <h3 className="text-xs text-gray-500 mb-2">Your Photo</h3>
              <input type="file" accept="image/*" onChange={handlePhotoChange} className="text-xs mb-2" />
              {photoPreview && <img src={photoPreview} alt="Your photo" className="max-h-48 rounded mb-2" />}

              <label className="text-xs text-gray-500 block mt-2">Garment type</label>
              <select value={garmentClass} onChange={(e) => setGarmentClass(e.target.value)} className="text-xs border rounded px-2 py-1 w-full">
                <option value="UPPER_BODY">Upper Body</option><option value="LOWER_BODY">Lower Body</option>
                <option value="FULL_BODY">Full Body</option><option value="FOOTWEAR">Footwear</option>
              </select>

              <div className="flex gap-2 mt-3">
                <button onClick={handleTryOn} disabled={!photo || loading}
                  className="flex-1 text-xs bg-black text-white py-2 rounded disabled:opacity-50">
                  {loading ? "Generating..." : `Try it on (${vtonEngine === "qwen_image_edit" ? "Neuron" : "FASHN"})`}
                </button>
                <button onClick={() => { setSelectedPid(""); setResultUrl(""); }}
                  className="text-xs border px-3 py-2 rounded hover:bg-gray-50">Cancel</button>
              </div>
            </div>

            {/* Result */}
            <div>
              <h3 className="text-xs text-gray-500 mb-2">Result</h3>
              {loading ? (
                <div className="text-sm text-gray-400 animate-pulse">Generating... (10-25s)</div>
              ) : resultUrl ? (
                <img src={resultUrl} alt="Try-on result" className="max-h-72 rounded" />
              ) : (
                <p className="text-xs text-gray-400 mt-8 text-center">Upload your photo and click "Try it on"</p>
              )}
            </div>
          </div>

          {/* Size Recommendation */}
          <div className="border-t mt-6 pt-4">
            <h3 className="text-sm font-medium mb-2">Size Recommendation</h3>
            {sizeRec ? (
              <div className="text-sm">
                <span className="font-medium">{sizeRec.recommendation}</span>
                {sizeRec.alternative && <span className="text-xs text-gray-400 ml-2">{sizeRec.alternative.note}</span>}
                <button onClick={() => setSizeRec(null)} className="text-xs text-[hsl(0,0%,55%)] hover:text-[hsl(0,0%,12%)] ml-2">Recalculate</button>
              </div>
            ) : (
              <div className="flex gap-2 items-end">
                <div>
                  <label className="text-[0.6rem] text-gray-400 block">Height (cm)</label>
                  <input type="number" value={sizeHeight} onChange={(e) => setSizeHeight(Number(e.target.value))} className="w-20 text-xs border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-[0.6rem] text-gray-400 block">Gender</label>
                  <select value={sizeGender} onChange={(e) => setSizeGender(e.target.value)} className="text-xs border rounded px-2 py-1">
                    <option value="women">Women</option><option value="men">Men</option>
                  </select>
                </div>
                <button onClick={handleGetSize} className="text-xs bg-black text-white px-3 py-1 rounded">Get my size</button>
              </div>
            )}
          </div>

          {/* Add to Cart */}
          {tryOnItems.some((it) => it.product_id === selectedPid && it.source === "tryon") && (
            <div className="border-t mt-4 pt-4">
              <h3 className="text-sm font-medium mb-2">Add to Cart</h3>
              <div className="flex gap-2 items-end">
                <div>
                  <label className="text-[0.6rem] text-gray-400 block">Size</label>
                  <select value={cartSize} onChange={(e) => setCartSize(e.target.value)} className="text-xs border rounded px-2 py-1">
                    <option value="">Select</option>
                    {(Array.isArray(product.sizes) ? product.sizes : Object.keys(product.sizes || {})).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <button onClick={handleAddToCart} className="text-xs bg-black text-white px-4 py-1.5 rounded">Add to Cart</button>
              </div>
            </div>
          )}
        </>
      ) : (
        !tryOnItems.length && !cartItems.length && (
          <div>
            <p className="text-gray-400 text-sm">Your try-on room and cart are empty. Browse products and add items to try on.</p>
            <button onClick={() => router.push("/shop")} className="mt-3 text-sm bg-black text-white px-4 py-2 rounded hover:bg-gray-800">Go Shopping</button>
          </div>
        )
      )}

      {/* Cart items grid */}
      {cartItems.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xs uppercase tracking-widest text-gray-400 font-medium border-b pb-2 mb-4">Items in your cart</h3>
          <div className="grid grid-cols-4 gap-3">
            {cartItems.map((item) => (
              <div key={item.cart_item_id} className="border rounded p-2 bg-white">
                <div className="text-xs font-medium truncate">{item.product_name}</div>
                <div className="text-[0.6rem] text-gray-400">{item.brand} · ${(Number(item.price) || 0).toFixed(2)} · {item.size}</div>
                <button onClick={() => setSelectedPid(item.product_id)}
                  className={`mt-1 text-xs w-full border py-1 rounded ${selectedPid === item.product_id ? "bg-black text-white" : "hover:bg-gray-50"}`}>
                  {selectedPid === item.product_id ? "Selected" : "Try on"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
