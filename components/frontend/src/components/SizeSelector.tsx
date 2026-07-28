"use client";
import { useState, useEffect, useRef } from "react";
import type { Product } from "@/lib/types";

interface Props {
  product: Product;
  onSelect: (size: string) => void;
  onClose: () => void;
}

export default function SizeSelector({ product, onSelect, onClose }: Props) {
  const [size, setSize] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const rawSizes = product.sizes || product.available_sizes || [];
  const sizes: string[] = Array.isArray(rawSizes) ? rawSizes : Object.keys(rawSizes);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={ref} onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-xl sm:rounded-xl shadow-xl w-full sm:max-w-sm p-5 animate-[toast-in_0.2s_ease-out]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[1.5px] text-[hsl(0,0%,55%)]">{product.brand}</p>
            <p className="text-sm font-medium">{product.name}</p>
          </div>
          <button onClick={onClose} className="text-[hsl(0,0%,60%)] hover:text-[hsl(0,0%,12%)] text-lg leading-none">&times;</button>
        </div>
        <p className="text-[11px] uppercase tracking-[1.5px] text-[hsl(0,0%,55%)] mb-2">Select Size</p>
        <div className="flex gap-2 flex-wrap mb-4">
          {sizes.map((s) => (
            <button key={s} onClick={() => setSize(s)}
              className={`px-4 py-2 text-sm border rounded-sm transition-colors ${
                size === s ? "bg-[hsl(0,0%,12%)] text-white border-[hsl(0,0%,12%)]" : "border-[hsl(0,0%,85%)] hover:border-[hsl(0,0%,50%)]"
              }`}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={() => { if (size) onSelect(size); }}
          disabled={!size}
          className="w-full py-2.5 text-sm font-medium tracking-wider uppercase bg-[hsl(0,0%,12%)] text-white rounded-sm hover:bg-[hsl(0,0%,20%)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Add to Cart
        </button>
      </div>
    </div>
  );
}
