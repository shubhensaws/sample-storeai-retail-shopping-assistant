// Fully serverless — no backend pods needed
// LAMBDA_API  = API Gateway + Lambda (data ops)
// MCP_GATEWAY = Bedrock AgentCore MCP Gateway (agent chat)
// Auth        = Cognito (direct from frontend)
const LAMBDA_API = process.env.NEXT_PUBLIC_LAMBDA_API_URL || "";
const MCP_GATEWAY_ID = process.env.NEXT_PUBLIC_MCP_GATEWAY_ID || "";

// Cognito token getter — set by CognitoAuthProvider
let _getIdToken: (() => string | null) = () => null;
export function setCognitoTokenGetter(fn: () => string | null) { _getIdToken = fn; }
export function getCognitoToken(): string | null { return _getIdToken(); }

// Append the Cognito token to our authenticated try-on image proxy paths only
// (relative /tryon-images or /tryon-results). Presigned S3 URLs (https://…) are
// left untouched — adding a query param would break their signature.
export function tryonImgSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (/^\/tryon-(images|results)\//.test(url)) {
    const t = _getIdToken();
    if (t) return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(t)}`;
  }
  return url;
}

async function lambdaRequest<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = _getIdToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  const res = await fetch(`${LAMBDA_API}${path}`, {
    headers, ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || err.error || res.statusText);
  }
  return res.json();
}

// --- Auth (Cognito + Lambda) ---
export const signIn = (body: { phone?: string; customer_id?: string }) =>
  lambdaRequest<any>(`/get_customer_profile?${body.customer_id ? `customer_id=${body.customer_id}` : `phone=${body.phone}`}`);
export const signOut = (_sessionId?: string) => Promise.resolve();

// --- Products (Lambda via API GW) ---
export const searchProducts = (params?: Record<string, string>) => {
  const qs = params ? "&" + new URLSearchParams(params).toString() : "";
  return lambdaRequest<any>(`/search_products?${qs}`);
};
export const getProduct = (id: string) =>
  lambdaRequest<any>(`/get_product_details?product_id=${id}`);

// --- Cart (Lambda via API GW) ---
export const getCart = (cid: string) =>
  lambdaRequest<any>(`/get_cart?customer_id=${cid}`);
export const addToCart = (cid: string, body: { product_id: string; size: string; quantity?: number }) =>
  lambdaRequest(`/add_to_cart`, { method: "POST", body: JSON.stringify({ customer_id: cid, ...body }) });
export const removeFromCart = (cid: string, cartItemId: string) =>
  lambdaRequest(`/remove_from_cart`, { method: "POST", body: JSON.stringify({ customer_id: cid, cart_item_id: cartItemId }) });
export const checkout = (cid: string, confirmSkipTryon = false) =>
  lambdaRequest<any>(`/checkout`, { method: "POST", body: JSON.stringify({ customer_id: cid, confirm_skip_tryon: confirmSkipTryon }) });

// --- Try-on (Lambda via API GW) ---
export const getTryOnRoom = (cid: string) =>
  lambdaRequest<any>(`/get_tryon_room?customer_id=${cid}`);
export const addToTryOnRoom = (cid: string, productId: string, source = "tryon") =>
  lambdaRequest(`/add_to_tryon_room`, { method: "POST", body: JSON.stringify({ customer_id: cid, product_id: productId, source }) });
export const removeFromTryOnRoom = (cid: string, productId: string) =>
  lambdaRequest(`/remove_from_tryon_room`, { method: "POST", body: JSON.stringify({ customer_id: cid, product_id: productId }) });
export const generateTryOn = (cid: string, body: { product_id: string; engine: string; vton_steps?: number; vton_cfg_scale?: number; vton_seed?: number }) =>
  lambdaRequest<any>(`/virtual_try_on`, { method: "POST", body: JSON.stringify({ customer_id: cid, ...body }) });

// --- Booth (Lambda via API GW) ---
export const getBoothQueue = () => lambdaRequest<any>(`/get_booth_queue`);
export const updateBoothStatus = (body: { customer_id: string; status: string }) =>
  lambdaRequest(`/update_booth_status`, { method: "POST", body: JSON.stringify({ customer_id: body.customer_id, booth_status: body.status }) });
export const saveSelectionCost = (cid: string, cost: any) =>
  lambdaRequest(`/update_customer_profile`, { method: "POST", body: JSON.stringify({ customer_id: cid, selection_cost: cost }) });
export const getCustomerProfile = (cid: string) =>
  lambdaRequest<any>(`/get_customer_profile?customer_id=${cid}`);

// --- Agent Chat (MCP Gateway via Bedrock AgentCore) ---
export const getMcpGatewayId = () => MCP_GATEWAY_ID;

// --- Chat persistence ---
export const saveChatMessage = (body: { session_id: string; role: string; content: string; customer_id?: string; cost?: any }) =>
  lambdaRequest(`/save_chat_message`, { method: "POST", body: JSON.stringify(body) });
export const getSessionCost = (sessionId: string) =>
  lambdaRequest<any>(`/get_session_cost?session_id=${sessionId}`);
export const loadChatHistory = (sessionId: string, limit = 20, lastKey?: string | null) => {
  let path = `/load_chat_history?session_id=${sessionId}&limit=${limit}`;
  if (lastKey) path += `&last_key=${encodeURIComponent(lastKey)}`;
  return lambdaRequest<any>(path);
};

// --- Try-on photo ---
export const uploadTryonPhoto = (body: { customer_id: string; photo_base64: string }) =>
  lambdaRequest(`/upload_tryon_photo`, { method: "POST", body: JSON.stringify(body) });
export const checkPhoto = (cid: string) =>
  lambdaRequest<{ exists: boolean; url: string }>(`/check_photo?customer_id=${cid}`);
export const getTryOnResults = (cid: string) =>
  lambdaRequest<any>(`/get_tryon_results?customer_id=${cid}`);

// --- QR code ---
export const generateTryOnQr = (cid: string) =>
  lambdaRequest<any>(`/generate_tryon_qr`, { method: "POST", body: JSON.stringify({ customer_id: cid }) });

// --- Size recommendation ---
export const saveMeasurements = (body: { customer_id: string; measurements: any; source: string }) =>
  lambdaRequest(`/save_measurements`, { method: "POST", body: JSON.stringify(body) });
export const recommendSize = (cid: string, productId: string) =>
  lambdaRequest<any>(`/recommend_size?customer_id=${cid}&product_id=${productId}`);
export const photoSizeRecommendation = (body: { customer_id: string; product_id: string; marker_color: string; marker_height_cm: number }) =>
  lambdaRequest<any>(`/photo_size_recommendation`, { method: "POST", body: JSON.stringify(body) });
