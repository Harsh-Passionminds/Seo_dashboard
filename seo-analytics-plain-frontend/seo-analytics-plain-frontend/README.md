# SEO Analytics — plain HTML/CSS/JavaScript frontend

No React, Tailwind, npm packages, or build step is required.

## Run locally
1. Start MySQL in XAMPP and confirm the backend migration succeeded.
2. In the backend folder, run `npm run dev`.
3. Serve this folder with VS Code Live Server, or run `python -m http.server 5500` here.
4. Open `http://127.0.0.1:5500`.
5. Default API URL: `http://localhost:5000/api`.

To change API URL, add this line before `js/app.js` in `index.html`:
```html
<script>window.API_BASE = "http://localhost:5000/api";</script>
<script src="./js/app.js"></script>
```

## API endpoints used
- `GET /health`
- `GET /api/auth/me`
- `GET /api/auth/google` (OAuth login)
- `GET /api/websites`, `POST /api/websites`
- `GET /api/websites/:websiteId/overview?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/websites/:websiteId/gsc?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/websites/:websiteId/ga4?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&reportType=summary|user_acquisition|traffic_acquisition`
- `POST /api/websites/:websiteId/sync`
- `GET /api/sync-jobs` (optional endpoint; check note below)

## Backend integration notes
- This frontend sends cookies with `credentials: "include"`. Express CORS must allow the exact frontend origin with credentials enabled.
- The starter backend may expose `GET /api/sync-jobs/:jobId` but not `GET /api/sync-jobs`. If the list call returns 404, Sync Activity will show an error; add a collection endpoint or remove that view.
- API response fields can differ by backend version; adjust `renderOverview`, `renderGsc`, `renderGa4`, or `loadAcquisition` to match actual response payloads.
- This UI renders no fake analytics values. Empty states are shown when no real rows are available.
- Never put database passwords, OAuth client secrets, session/JWT secrets, or token encryption keys in frontend files.
