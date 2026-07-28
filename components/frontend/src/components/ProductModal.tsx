"use client";
import { useState } from "react";
import type { Product } from "@/lib/types";

interface Props {
  product: Product;
  onClose: () => void;
  onAddToCart?: (p: Product, size: string) => void;
  onTryOn?: (p: Product) => void;
}

export default function ProductModal({ product, onClose, onAddToCart, onTryOn }: Props) {
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState("center center");
  const [size, setSize] = useState("");
  const rawSizes = product.sizes || product.available_sizes || [];
  // sizes can be array ["S","M"] or dict {"S":10,"M":15}
  const sizeEntries: { label: string; stock: number | null }[] = Array.isArray(rawSizes)
    ? rawSizes.map((s) => ({ label: s, stock: null }))
    : Object.entries(rawSizes).filter(([, q]) => typeof q === "number" && q > 0).map(([s, q]) => ({ label: s, stock: q as number }));
  const imgSrc = product.image_url || `/images/${product.image_file}`;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!zoomed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setOrigin(`${x}% ${y}%`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col md:flex-row">
          {/* Image with zoom */}
          <div className="md:w-1/2 relative bg-gray-50 overflow-hidden cursor-zoom-in"
            onClick={() => setZoomed(!zoomed)} onMouseMove={handleMouseMove} onMouseLeave={() => setOrigin("center center")}>
            <img src={imgSrc} alt={product.name}
              style={{ transformOrigin: origin }}
              className={`w-full h-80 md:h-full object-cover transition-transform duration-200 ${zoomed ? "scale-[2.5]" : ""}`} />
            <span className="absolute bottom-2 right-2 text-[0.6rem] bg-black/50 text-white px-2 py-0.5 rounded">
              {zoomed ? "Click to zoom out" : "Click to zoom"}
            </span>
          </div>

          {/* Details */}
          <div className="md:w-1/2 p-6 flex flex-col">
            <button onClick={onClose} className="self-end text-gray-400 hover:text-black text-xl leading-none">&times;</button>
            <div className="text-[0.65rem] uppercase tracking-widest text-gray-400 font-medium">{product.brand} · {product.product_id}</div>
            <h2 className="text-xl font-semibold mt-1">{product.name}</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-2xl font-bold">${(Number(product.price) || 0).toFixed(2)}</span>
              <span className="text-sm text-gray-400">⭐ {product.rating}</span>
            </div>
            {product.description && <p className="text-sm text-gray-500 mt-3">{product.description}</p>}
            {product.material && <p className="text-xs text-gray-400 mt-1">Material: {product.material}</p>}
            {product.colors && <p className="text-xs text-gray-400 mt-1">Colors: {product.colors.join(", ")}</p>}

            {/* Size selector */}
            <div className="mt-4">
              <label className="text-xs font-medium text-gray-600">Size</label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {sizeEntries.map((s) => (
                  <button key={s.label} onClick={() => setSize(s.label)}
                    className={`px-3 py-1 text-sm border rounded ${size === s.label ? "bg-black text-white" : "hover:bg-gray-50"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              {size && sizeEntries.find((s) => s.label === size)?.stock != null && (
                <p className="text-xs text-gray-400 mt-1">{sizeEntries.find((s) => s.label === size)!.stock} in stock</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 mt-6">
              {onAddToCart && (
                <button onClick={() => { if (!size) return; onAddToCart(product, size); }}
                  disabled={!size}
                  className="w-full text-sm bg-[hsl(0,0%,12%)] text-white py-2.5 rounded-sm hover:bg-[hsl(0,0%,20%)] font-medium tracking-wider uppercase disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {size ? "Add to Cart" : "Select a size"}
                </button>
              )}
              {onTryOn && (
                <button onClick={() => onTryOn(product)}
                  className="w-full text-sm border-2 border-[hsl(0,0%,12%)] py-2.5 rounded-sm hover:bg-[hsl(40,10%,96%)] font-medium tracking-wider uppercase transition-colors">
                  Add to Try-On Room
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
