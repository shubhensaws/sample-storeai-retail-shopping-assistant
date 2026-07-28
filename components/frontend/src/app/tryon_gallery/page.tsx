"use client";
import { useState, useEffect } from "react";
import { tryonImgSrc } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_LAMBDA_API_URL || "";
interface Customer { customer_id: string; customer_name: string; image_count: number; last_image: string }
interface TryonImage { product_id: string; product_name: string; result_url: string; s3_key?: string }

function extractTryonPath(url: string): string {
  const match = url.match(/tryon-results\/(.+?)(?:\?|$)/);
  return match ? `/tryon-images/${match[1]}` : url;
}

export default function TryonGalleryPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [images, setImages] = useState<TryonImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [customerName, setCustomerName] = useState("");

  useEffect(() => {
    fetch(`${API}/get_tryon_results`).then(r => r.json()).then(d => setCustomers(d.customers || [])).catch(() => {});
    // Auto-load from URL param (for QR code sharing)
    const params = new URLSearchParams(window.location.search);
    const cid = params.get("customer_id");
    if (cid) loadImages(cid);
  }, []);

  const loadImages = async (cid: string) => {
    setSelected(cid);
    setLoading(true);
    try {
      const r = await fetch(`${API}/get_tryon_results?customer_id=${cid}`).then(r => r.json());
      setImages(r.results || []);
      setCustomerName(r.customer_name || cid);
    } catch { setImages([]); }
    setLoading(false);
  };

  const downloadImage = async (img: TryonImage) => {
    const url = tryonImgSrc(extractTryonPath(img.result_url));
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `StoreAI_${img.product_name.replace(/\s+/g, "_")}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  };

  const downloadAll = async () => {
    for (const img of images) {
      await downloadImage(img);
      await new Promise(r => setTimeout(r, 400));
    }
  };

  // Shared view (from QR code) — simpler UI
  const isSharedView = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("customer_id");

  if (isSharedView && selected) {
    return (
      <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "system-ui", padding: "24px 16px" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, margin: "0 0 4px", color: "#232f3e" }}>StoreAI Virtual Try-On</h1>
            <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>{customerName}&apos;s try-on results</p>
          </div>
          {loading && <p style={{ textAlign: "center", color: "#6b7280" }}>Loading your images...</p>}
          {!loading && images.length === 0 && <p style={{ textAlign: "center", color: "#9ca3af" }}>No try-on images found</p>}
          {!loading && images.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                <button onClick={downloadAll} style={{ padding: "10px 24px", background: "#232f3e", color: "#fff",
                  border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                  Save All Photos ({images.length})
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {images.map((img, i) => (
                  <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
                    <img src={tryonImgSrc(extractTryonPath(img.result_url))} alt={img.product_name} style={{ width: "100%", display: "block" }} />
                    <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14, color: "#374151", fontWeight: 500 }}>{img.product_name}</span>
                      <button onClick={() => downloadImage(img)} style={{ padding: "6px 12px", background: "#f3f4f6",
                        border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                        Save
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 24 }}>
                Long-press on an image to save directly to your phone
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Admin gallery view (full customer list)
  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui" }}>
      <div style={{ width: 320, borderRight: "1px solid #e5e7eb", overflowY: "auto", background: "#f9fafb" }}>
        <h2 style={{ padding: "16px", margin: 0, fontSize: 18, borderBottom: "1px solid #e5e7eb" }}>
          Try-On Gallery ({customers.length})
        </h2>
        {customers.map(c => (
          <div key={c.customer_id} onClick={() => loadImages(c.customer_id)}
            style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #f0f0f0",
              background: selected === c.customer_id ? "#e0e7ff" : "transparent" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#232f3e" }}>{c.customer_name}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              {c.customer_id} · {c.image_count} images · {new Date(c.last_image).toLocaleString()}
            </div>
          </div>
        ))}
        {customers.length === 0 && <p style={{ padding: 16, color: "#9ca3af" }}>No try-on images found</p>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {!selected && <p style={{ color: "#9ca3af", textAlign: "center", marginTop: 100 }}>Select a customer to view try-on images</p>}
        {loading && <p style={{ color: "#6b7280" }}>Loading...</p>}
        {selected && !loading && images.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{customerName} — {images.length} images</h3>
              <button onClick={downloadAll} style={{ padding: "8px 16px", background: "#232f3e", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                Download All
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {images.map((img, i) => (
                <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                  <img src={tryonImgSrc(extractTryonPath(img.result_url))} alt={img.product_name} style={{ width: "100%", display: "block" }} />
                  <div style={{ padding: "8px 12px", fontSize: 13, color: "#374151", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{img.product_name}</span>
                    <button onClick={() => downloadImage(img)} style={{ padding: "4px 8px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>Save</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {selected && !loading && images.length === 0 && <p style={{ color: "#9ca3af" }}>No images for this customer</p>}
      </div>
    </div>
  );
}
