export interface Product {
  product_id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  colors: string[];
  sizes?: string[];
  available_sizes?: string[];
  image_url?: string;
  image_file?: string;
  material: string;
  description: string;
  rating: number;
  reviews_count: number;
  gender: string;
  body_region: string;
  garment_type: string;
}

export interface CartItem {
  cart_item_id: string;
  product_id: string;
  product_name: string;
  brand: string;
  size: string;
  quantity: number;
  price: number;
}

export interface Customer {
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TryOnRoomItem {
  product_id: string;
  product_name: string;
  source: "tryon" | "cart";
}

export interface BoothQueueItem {
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  cart_count: number;
  tryon_count: number;
  total_items: number;
}

export type VTONEngine = "qwen_image_edit" | "fashn_vton";
export type DemoMode = "standard" | "booth";
export type BoothStation = "shopping" | "tryon";
