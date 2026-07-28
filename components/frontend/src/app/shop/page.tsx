"use client";
import { useEffect, useState, useMemo } from "react";
import ProductCard from "@/components/ProductCard";
import ProductModal from "@/components/ProductModal";
import SizeSelector from "@/components/SizeSelector";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import * as api from "@/lib/api";
import type { Product } from "@/lib/types";

type SortKey = "name" | "price-asc" | "price-desc" | "rating";

export default function ShopPage() {
  const { customer } = useAuth();
  const cfg = useConfig();
  const { toast } = useToast();
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [sizeProduct, setSizeProduct] = useState<Product | null>(null);
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [gender, setGender] = useState("");
  const [query, setQuery] = useState("");
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(200);
  const [sortBy, setSortBy] = useState<SortKey>("name");

  useEffect(() => {
    const params: Record<string, string> = {};
    if (category) params.category = category;
    if (brand) params.brand = brand;
    if (gender) params.gender = gender;
    if (query) params.query = query;
    if (minPrice > 0) params.min_price = String(minPrice);
    if (maxPrice < 200) params.max_price = String(maxPrice);
    api.searchProducts(params).then((r) => setAllProducts(r.products)).catch(() => {});
  }, [category, brand, gender, query, minPrice, maxPrice]);

  const brands = useMemo(() => [...new Set(allProducts.map((p) => p.brand))].sort(), [allProducts]);
  const categories = useMemo(() => [...new Set(allProducts.map((p) => p.category))].sort(), [allProducts]);

  const products = useMemo(() => {
    const sorted = [...allProducts];
    switch (sortBy) {
      case "price-asc": sorted.sort((a, b) => a.price - b.price); break;
      case "price-desc": sorted.sort((a, b) => b.price - a.price); break;
      case "rating": sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
      default: sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [allProducts, sortBy]);

  const checkItemCap = async (): Promise<boolean> => {
    if (cfg.demoMode !== "booth" || !customer) return true;
    const [cart, tryon] = await Promise.all([
      api.getCart(customer.customer_id).catch(() => ({ items: [] })),
      api.getTryOnRoom(customer.customer_id).catch(() => ({ items: [] })),
    ]);
    if ((cart.items?.length || 0) + (tryon.items?.length || 0) >= cfg.boothItemCap) {
      toast(`You already have ${cfg.boothItemCap} items selected (maximum). Remove one first.`, "info");
      return false;
    }
    return true;
  };

  const handleQuickAddToCart = (p: Product) => {
    if (!customer) { toast("Sign in via Assistant first", "info"); return; }
    setSizeProduct(p);
  };

  const handleSizeSelected = async (size: string) => {
    if (!sizeProduct || !customer) return;
    if (!await checkItemCap()) { setSizeProduct(null); return; }
    try {
      await api.addToCart(customer.customer_id, { product_id: sizeProduct.product_id, size });
      toast(`${sizeProduct.name} (${size}) added to cart`);
    } catch { toast("Failed to add to cart", "error"); }
    setSizeProduct(null);
  };

  const handleAddToCart = async (p: Product, size: string) => {
    if (!customer) { toast("Sign in via Assistant first", "info"); return; }
    if (!await checkItemCap()) return;
    try {
      await api.addToCart(customer.customer_id, { product_id: p.product_id, size });
      toast(`${p.name} (${size}) added to cart`);
      setSelected(null);
    } catch { toast("Failed to add to cart", "error"); }
  };

  const handleTryOn = async (p: Product) => {
    if (!customer) { toast("Sign in via Assistant first", "info"); return; }
    if (!await checkItemCap()) return;
    try {
      await api.addToTryOnRoom(customer.customer_id, p.product_id);
      toast(`${p.name} added to try-on room`);
    } catch { toast("Failed to add to try-on room", "error"); }
  };

  const handleSelect = async (p: Product) => {
    setSelected(p);
    const full = await api.getProduct(p.product_id).catch(() => null);
    if (full) setSelected({ ...p, ...full });
  };

  const selectClass = "border border-[hsl(0,0%,90%)] rounded-sm px-3 py-1.5 text-xs bg-white text-[hsl(0,0%,30%)] focus:outline-none focus:border-[hsl(0,0%,60%)]";

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-light tracking-tight text-[hsl(0,0%,12%)]">Shop</h1>
        <p className="text-sm text-[hsl(0,0%,55%)] mt-1">{products.length} product{products.length !== 1 ? "s" : ""}</p>
      </div>

      <div className="flex gap-3 mb-8 flex-wrap items-end">
        <input placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)}
          className="border border-[hsl(0,0%,90%)] rounded-sm px-3 py-1.5 text-xs w-48 bg-white focus:outline-none focus:border-[hsl(0,0%,60%)]" />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setBrand(""); }} className={selectClass}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
        <select value={brand} onChange={(e) => { setBrand(e.target.value); setCategory(""); }} className={selectClass}>
          <option value="">All Brands</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={gender} onChange={(e) => setGender(e.target.value)} className={selectClass}>
          <option value="">All</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
          <option value="unisex">Unisex</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} className={selectClass}>
          <option value="name">Default</option>
          <option value="price-asc">Price: Low → High</option>
          <option value="price-desc">Price: High → Low</option>
          <option value="rating">Top Rated</option>
        </select>
      </div>

      <div className="space-y-12">
        {(() => {
          const CAT_ORDER = ["tops", "bottoms", "dresses", "footwear", "accessories", "outerwear"];
          const CAT_GROUP: Record<string, string> = {};
          products.forEach((p) => {
            const c = p.category || "";
            if (c.includes("tshirt") || c.includes("polo") || c.includes("shirt") || c.includes("blouse") || c.includes("croptop") || c.includes("hoodie") || c.includes("sweater") || c.includes("cardigan")) CAT_GROUP[c] = "tops";
            else if (c.includes("jeans") || c.includes("chinos") || c.includes("shorts") || c.includes("joggers") || c.includes("skirt") || c.includes("leggings")) CAT_GROUP[c] = "bottoms";
            else if (c.includes("dress")) CAT_GROUP[c] = "dresses";
            else if (c.includes("jacket")) CAT_GROUP[c] = "outerwear";
            else if (c.includes("sneaker") || c.includes("shoe") || c.includes("loafer") || c.includes("boot") || c.includes("sandal") || c.includes("slipper")) CAT_GROUP[c] = "footwear";
            else CAT_GROUP[c] = c;
          });
          const groups = new Map<string, typeof products>();
          products.forEach((p) => {
            const g = CAT_GROUP[p.category] || p.category;
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g)!.push(p);
          });
          const ordered = [...groups.keys()].sort((a, b) => {
            const ai = CAT_ORDER.indexOf(a), bi = CAT_ORDER.indexOf(b);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });
          return ordered.map((cat) => (
            <section key={cat}>
              <h2 className="text-[11px] font-medium uppercase tracking-[3px] text-[hsl(0,0%,55%)] border-b border-[hsl(0,0%,90%)] pb-3 mb-6">
                {cat}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
                {groups.get(cat)!.map((p) => (
                  <ProductCard key={p.product_id} product={p} onClick={handleSelect}
                    onAddToCart={handleQuickAddToCart} onTryOn={handleTryOn} />
                ))}
              </div>
            </section>
          ));
        })()}
      </div>
      {products.length === 0 && <p className="text-[hsl(0,0%,55%)] text-sm mt-16 text-center">No products match your filters.</p>}

      {selected && (
        <ProductModal product={selected} onClose={() => setSelected(null)}
          onAddToCart={handleAddToCart} onTryOn={handleTryOn} />
      )}
      {sizeProduct && (
        <SizeSelector product={sizeProduct} onSelect={handleSizeSelected} onClose={() => setSizeProduct(null)} />
      )}
    </div>
  );
}
