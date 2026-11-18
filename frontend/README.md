# SEO Analytics React frontend

This React/Vite frontend uses the existing Express API. It does not keep credentials or session tokens in browser storage; authenticated API calls use the backend's HttpOnly session cookie.

## Run locally

1. Start the backend on port `4000`.
2. In this directory, install dependencies and start Vite:

   ```sh
   npm install
   npm run dev
   ```

3. Open the Vite URL (normally `http://localhost:5173`).
4. For Admin Google OAuth, set the backend's `FRONTEND_URL` to the Vite URL, for example `http://localhost:5173`. Make sure the Google OAuth redirect URI is the backend's `/api/auth/google/callback` URL.

Vite proxies `/api` requests to `http://localhost:4000` by default. Override the proxy target with `VITE_API_PROXY_TARGET` if the backend runs elsewhere. To call a remote API directly (without Vite's proxy), set `VITE_API_BASE_URL` to its full API prefix, such as `https://api.example.com/api`. When using a separate frontend/API origin, configure the backend `FRONTEND_URL` and cookie/CORS settings for that deployment.

Copy `.env.example` to `.env.local` if you need to override the local defaults. Vite environment variables are public client configuration; do not put credentials or secrets in them.

## Backend integration

- `src/services/api.js` is the shared fetch client. It includes cookies and surfaces backend error messages.
- `src/services/endpoints.js` contains route wrappers. Admin API responses use the `{ success, message, data }` envelope; member and activity list data are nested with pagination inside `data`.
- `src/hooks/useSession.js` reads the authenticated user, role and permissions from `/api/auth/me`.
- Employee and Admin capabilities are reflected in the UI, but authorization is enforced by the backend.
- Reports, comparisons and server exports use persisted backend analytics. Local CSV actions are shown only when `/auth/me` grants report-export permission.

## Checks

```sh
npm run lint
npm run build
```
