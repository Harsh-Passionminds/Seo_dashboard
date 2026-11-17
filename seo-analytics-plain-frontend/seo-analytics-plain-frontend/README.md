# SEO Analytics — plain HTML/CSS/JavaScript frontend

No React, Tailwind, npm packages, or build step is required.

## Run locally
1. Start MySQL in XAMPP and confirm the backend migration succeeded.
2. In the backend folder, run `npm run dev`.
3. Serve this folder with VS Code Live Server, or run `python -m http.server 5500` here.
4. Open `http://127.0.0.1:5500`.
5. The frontend's checked-in API URL is `http://localhost:5000/api`; set `window.API_BASE` to `http://localhost:4000/api` when using the backend's default port.

To change API URL, add this line before `js/app.js` in `index.html`:
```html
<script>window.API_BASE = "http://localhost:4000/api";</script>
<script src="./js/app.js"></script>
```

## Sign-in and roles
- Organization Admins sign in with Google OAuth.
- Analysts and Viewers sign in with the username and password provisioned by an Admin; they do not connect Google accounts.
- Employees only see websites assigned to them. Admin-only management and synchronization controls are hidden for employees and remain protected by the backend.
- A generated temporary password must be changed before workspace access. Passwords are not stored in browser storage.
- Report exports are shown according to the authenticated role and organization policy.

## API endpoints used
- `GET /health`
- `GET /api/auth/me`
- `GET /api/auth/google` (Admin OAuth login)
- `POST /api/auth/login` (employee login)
- `POST /api/auth/change-password` (temporary password)
- `GET /api/websites` (Admin websites or employee-assigned websites)
- `POST /api/websites` (Admin only)
- `GET /api/websites/:websiteId/overview?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/websites/:websiteId/gsc?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/websites/:websiteId/ga4?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&reportType=summary|user_acquisition|traffic_acquisition`
- `POST /api/websites/:websiteId/sync` (Admin only)
- `GET /api/sync-jobs` (Admin only)
- `POST /api/admin/users` (Admin employee account creation)
- `POST /api/admin/users/:userId/password` (Admin password reset)
- `PUT /api/admin/website-access/:userId` (Admin website grants)

## Backend integration notes
- This frontend sends cookies with `credentials: "include"`. The backend must allow the exact frontend origin with credentials enabled; set `FRONTEND_URL` in the backend `.env`.
- Date presets support 7, 28, and 90 days, and the custom date fields support arbitrary date ranges accepted by the API.
- Enable **Compare previous period** to compare the selected range to the immediately preceding range of equal length. The frontend requests both periods and shows KPI changes and aligned daily GSC/GA4 values.
- Acquisition dimensions map directly to API-supported GA4 dimensions: `default_channel_group` or `source_medium`. The source/medium table displays the API's `dimensionValue` (for example, `google / organic`); separate source-only and medium-only dimensions are not currently provided by the backend.
- User Acquisition is grouped by dimension value for the selected range, like Traffic Acquisition. Daily counts/revenue are summed and daily engagement rate/session duration are averaged; daily total/active user counts are not distinct users across the full range.
- The backend API contract is documented in [FRONTEND_API.md](../../seo-analytics-backend/seo-analytics-backend/FRONTEND_API.md). That guide is the source of truth for request parameters, response shapes, authentication, and errors.
- This UI renders no fake analytics values. Empty states are shown when no real rows are available.
- Never put database passwords, OAuth client secrets, session/JWT secrets, or token encryption keys in frontend files.
