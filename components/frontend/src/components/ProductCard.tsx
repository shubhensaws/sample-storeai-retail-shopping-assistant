"use client";
import type { Product } from "@/lib/types";

interface Props {
  product: Product;
  onClick?: (p: Product) => void;
  onAddToCart?: (p: Product) => void;
  onTryOn?: (p: Product) => void;
}

export default function ProductCard({ product, onClick, onAddToCart, onTryOn }: Props) {
  const imgSrc = product.image_url || `/images/${product.image_file}`;
  return (
    <div className="group cursor-pointer" onClick={() => onClick?.(product)}>
      <div className="aspect-[4/5] overflow-hidden rounded-sm bg-[hsl(40,10%,95%)] mb-3">
        <img src={imgSrc} alt={product.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
      </div>
      <div className="space-y-1">
        <p className="text-[10px] text-[hsl(0,0%,55%)] uppercase tracking-[1.5px]">{product.brand}</p>
        <h3 className="text-sm font-medium leading-tight text-[hsl(0,0%,12%)]">{product.name}</h3>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">${(Number(product.price) || 0).toFixed(2)}</p>
          {product.rating && (
            <div className="flex items-center gap-1">
              <svg className="h-3 w-3 fill-[hsl(45,93%,47%)] text-[hsl(45,93%,47%)]" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
              <span className="text-[11px] text-[hsl(0,0%,55%)]">{product.rating}</span>
            </div>
          )}
        </div>
        <div className="text-[10px] text-[hsl(0,0%,65%)]">{(product.sizes || product.available_sizes || []).join(", ")}</div>
        <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          {onAddToCart && (
            <button onClick={() => onAddToCart(product)}
              className="flex-1 text-[11px] bg-[hsl(0,0%,12%)] text-white py-1.5 rounded-sm hover:bg-[hsl(0,0%,20%)] transition-colors tracking-wide uppercase">
              Add to Cart
            </button>
          )}
          {onTryOn && (
            <button onClick={() => onTryOn(product)}
              className="flex-1 text-[11px] border border-[hsl(0,0%,12%)] py-1.5 rounded-sm hover:bg-[hsl(40,10%,96%)] transition-colors tracking-wide uppercase">
              Try On
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
