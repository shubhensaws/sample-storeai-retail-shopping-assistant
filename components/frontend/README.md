# StoreAI v2 Frontend

Next.js 14 static app with voice interaction, virtual try-on, and shopping cart UI.

## Build

```bash
# Production build (static export to out/)
NEXT_PUBLIC_LAMBDA_API_URL="" NEXT_PUBLIC_NOVA_SONIC_HOST="" npm run build

# Local dev (hot reload)
npm run dev
```

## Architecture

- Static export (`output: "export"`) — deployed to S3 + CloudFront
- All API calls use **same-origin relative paths** (no hardcoded backend URLs)
- CloudFront routes API paths (`/chat*`, `/search_*`, etc.) to the ALB backend
- Frontend assets (`/_next/*`, `*.html`) served from S3

## Environment Variables (build-time)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_LAMBDA_API_URL` | `""` (same-origin) | API base URL — leave empty for CloudFront deploy |
| `NEXT_PUBLIC_NOVA_SONIC_HOST` | `""` (same-origin) | Voice WebSocket host — leave empty for CloudFront deploy |
| `NEXT_PUBLIC_DEMO_MODE` | `booth` | UI mode: `booth` (kiosk) or `standard` |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | `""` | Cognito pool (optional, for auth) |
| `NEXT_PUBLIC_COGNITO_WEB_CLIENT_ID` | `""` | Cognito client (optional, for auth) |

## Key Paths

```
src/
├── app/
│   ├── assistant/page.tsx    # Main chat + voice UI
│   ├── shop/page.tsx         # Product catalog grid
│   ├── cart/page.tsx         # Shopping cart
│   ├── virtual-tryon/page.tsx # Virtual try-on camera
│   └── tryon-room/page.tsx   # Try-on queue management
├── components/               # Shared UI components
├── context/                  # Auth, Config, Toast providers
├── hooks/                    # Custom hooks
└── lib/
    └── api.ts               # API client (all endpoints)
```
