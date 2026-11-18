# SEO Analytics frontend developer guide

This is the API contract for the plain JavaScript frontend and other clients integrating with this backend. The backend owns authentication, Google API access, synchronization, and database access. The browser must not call Google APIs directly, handle Google OAuth tokens, or connect to MySQL.

## Start here: frontend integration flow

The fastest safe path to build a frontend against this API is:

1. Configure the API base URL and send cookies on every API request.
2. On application startup, call `GET /api/auth/me`.
3. If unauthenticated, show both login choices: Admin Google sign-in and employee username/password sign-in.
4. If `mustChangePassword` is true, show the password-change screen and do not load workspace data yet.
5. Once authenticated, use `membership.role` and `permissions` to choose which controls to render. Treat these values as display hints only; the API enforces access server-side.
6. Load `GET /api/websites`, keep the selected `website_id` in UI state, and pass it to website-scoped requests.
7. Fetch reports with an inclusive date range. They return persisted SQL data; request a sync separately only when the UI has an Admin action for it.

The API is cookie-authenticated. Do not send a user ID, organization ID, role, or website permission as an authorization claim. Do not store passwords or session data in `localStorage` or `sessionStorage`.

### Application startup and login

```js
const API_BASE = (window.API_BASE || "http://localhost:4000/api").replace(/\/+$/, "");
const api = window.ApiClient.createApiClient({
  baseUrl: API_BASE,
  onUnauthorized: () => showLogin()
});

const session = await api.request("/auth/me");

if (!session.authenticated) {
  showLogin();
} else if (session.mustChangePassword) {
  showRequiredPasswordChange();
} else if (!session.organization || !session.membership) {
  showAccountContextError();
} else {
  showWorkspace(session);
  const { websites } = await api.request("/websites");
  renderWebsites(websites);
}
```

Employee sign-in is a JSON `POST /api/auth/login` with `{ "username": "...", "password": "..." }`. The response sets an HttpOnly cookie and returns `mustChangePassword`; follow up with `GET /api/auth/me` to load identity, role, permissions, and organization. Admin sign-in must be a browser redirect, not `fetch`:

```js
window.location.assign(`${API_BASE}/auth/google`);
```

The OAuth callback redirects the browser back to the configured frontend URL. Analyst and Viewer accounts cannot use Google OAuth.

### Website and report loading

After `/websites` returns, render only those returned sites. For each website-specific API call, use its database `website_id`; never infer that changing an ID in the browser grants access. Example:

```js
const query = new URLSearchParams({
  startDate: "2026-11-01",
  endDate: "2026-11-17"
});
const report = await api.request(`/websites/${websiteId}/overview?${query}`);
```

All dates are calendar dates in `YYYY-MM-DD` form, and both endpoints are inclusive. Report APIs read stored data. A successful response may contain empty arrays when there are no persisted rows.

### Admin employee-management screens

Only an Admin should see the Administration screen. Use `POST /api/admin/users` to create Analyst/Viewer password accounts, including the selected website IDs. If the Admin leaves the password empty, display the returned `data.temporaryPassword` once and provide it to the employee securely. Use `PUT /api/admin/website-access/:userId` to replace assignments, `PATCH` to change role or status, and `POST /api/admin/users/:userId/password` to reset a password. Do not render a Google-account field for employees.

Invitations are a separate Google Admin flow: `POST /api/admin/users/invite` only accepts `role: "admin"` and requires configured SMTP. It is not the employee account-creation endpoint.

### Report export downloads

`GET /api/websites/:websiteId/reports/export` returns a file, not JSON. Use a blob/download helper (or `api.download`) and handle JSON error bodies when the response is not successful. Export permission is checked on every request: Admins can export, Analysts require `reportExportsEnabled`, and Viewers require `viewerExportsEnabled`.

## 1. Local setup and API base URL

The backend defaults to port `4000` (`PORT` in the backend environment can override it). The checked-in plain frontend currently defaults to port `5000` in `js/app.js`. Configure these to match before using the UI. For example, to use the backend default, set `window.API_BASE` before loading the frontend application script:

```text
http://localhost:4000/api
```

Run the backend from the backend project directory:

```powershell
npm install
npm run migrate
npm run dev
```

Serve the frontend with VS Code Live Server or a static web server. The backend does not serve the frontend files.

The supplied frontend reads `window.API_BASE` before loading `js/app.js`. Set it in `index.html` when the API uses a different origin or port:

```html
<script>window.API_BASE = "https://api.example.com/api";</script>
<script src="./js/app.js"></script>
```

Set backend `FRONTEND_URL` to the frontend origin so the OAuth callback returns to the correct app. The React/Vite frontend uses `http://localhost:5173` by default and proxies `/api` to the backend in development; direct browser API calls are also allowed from `FRONTEND_URL` and, outside production, `http://localhost:5173` and `http://127.0.0.1:5173`. Credentialed `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` requests are supported. The plain frontend must be served from an allowed origin rather than opened as a `file://` URL. Cookie-based requests must use `credentials: "include"`; production deployments must use HTTPS and an exact `FRONTEND_URL`.

## 2. Authentication, ownership, and request conventions

- Organization Admins start Google OAuth by navigating the browser to `GET /api/auth/google`. Analysts and Viewers use `POST /api/auth/login` with their Admin-created username and password. Google OAuth callback rejects active Analyst/Viewer accounts.
- Employee passwords are bcrypt-hashed (cost 12), never returned by API, and never stored in browser storage. A blank password at account creation or an Admin reset generates a one-time temporary password; the employee must change it before any website, report, or Admin route will work.
- Employee login is rate-limited to 10 attempts per IP per 15 minutes. Invalid username and password responses are identical. Sessions use the existing HTTP-only `seo_session` cookie, expire after seven days, and are invalidated on logout, password reset/change, or deactivation. Website grants are checked on each request, so revoking a grant blocks the next request without waiting for the session to expire.
- On successful Admin OAuth callback the backend stores encrypted tokens for that Admin's authorized integration record, sets the session cookie, schedules freshness checks, and redirects to `FRONTEND_URL/`. Employee browser code never receives OAuth tokens.
- Include `credentials: "include"` in browser `fetch` calls. The cookie is not available to JavaScript and must not be copied into local storage.
- Send JSON requests with `Content-Type: application/json`.
- Website and report routes require a signed-in active organization membership. Admins can access all active organization websites; Analysts and Viewers must have a current `website_permissions.can_view` grant. Website IDs are checked server-side on each request.
- Website creation, Google integration, and sync operations are Admin-only. Employee roles are read-only for stored analytics. Admin routes require the `admin` role. Organization identity and role are resolved server-side; clients must not send organization IDs or permission claims.
- Dates use `YYYY-MM-DD`, and ranges include both start and end dates. Website report routes and keyword history reject invalid, reversed, or more-than-550-day ranges.
- GSC CTR is a ratio: `0.025` represents `2.5%`. For multiple days, calculate combined CTR as summed clicks divided by summed impressions; do not average daily CTRs.
- Empty arrays mean no rows are stored for the requested period. Do not generate placeholder metrics or missing date rows.

The supplied static frontend provides `window.ApiClient.createApiClient` in `js/api.js`. Its `request(path, options)` method includes cookies, parses JSON/text responses, treats `204 No Content` correctly, and reports API failures. Its `download(path, options)` method handles file attachments and filenames. If implementing a different client, preserve those behaviors:

```js
const API_BASE = (window.API_BASE || "http://localhost:4000/api").replace(/\/$/, "");
const api = window.ApiClient.createApiClient({ baseUrl: API_BASE });

const session = await api.request("/auth/me");
const websites = await api.request("/websites");
await api.download(`/websites/${websiteId}/reports/export?source=gsc&startDate=2026-11-01&endDate=2026-11-17`);
```

## 2.1 Endpoint index

All paths below are relative to the backend origin except `GET /health`, which is outside the `/api` prefix. `:websiteId` is the numeric `website_id` returned by `GET /api/websites`; `:keywordId` is `keyword_id`.

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Backend/database health |
| `GET` | `/api/auth/google` | Public browser redirect | Start Admin Google OAuth |
| `GET` | `/api/auth/google/callback` | Admin OAuth redirect | Finish Admin OAuth; sets session and redirects |
| `POST` | `/api/auth/login` | Public, rate-limited | Employee username/password login |
| `POST` | `/api/auth/change-password` | Signed-in temporary-password account | Change required temporary password |
| `GET` | `/api/auth/me` | Optional session | Get session and Google connection state |
| `POST` | `/api/auth/logout` | Optional session | Clear application session |
| `POST` | `/api/auth/disconnect-google` | Organization Admin | Deactivate the Admin's Google connection and clear session |
| `POST` | `/api/auth/invitations/accept` | Signed-in Google invitee | Accept an Admin invitation using its token |
| `GET` | `/api/admin/overview` | Organization Admin | Organization counts and recent activity |
| `GET` | `/api/admin/users` | Organization Admin | Search, filter, sort, and page through members |
| `POST` | `/api/admin/users` | Organization Admin | Create Analyst or Viewer account and assign websites |
| `GET` | `/api/admin/users/:userId` | Organization Admin | Read one member |
| `POST` | `/api/admin/users/:userId/password` | Organization Admin | Reset employee password; returns a temporary password once |
| `PATCH` | `/api/admin/users/:userId/role` | Organization Admin | Change a member's role |
| `PATCH` | `/api/admin/users/:userId/status` | Organization Admin | Activate or deactivate a member |
| `DELETE` | `/api/admin/users/:userId` | Organization Admin | Revoke organization access and sessions |
| `POST` | `/api/admin/users/invite` | Organization Admin | Create and email a Google Admin invitation |
| `GET` | `/api/admin/invitations` | Organization Admin | List invitations |
| `GET` | `/api/admin/invitations/:invitationId` | Organization Admin | Read one invitation |
| `POST` | `/api/admin/invitations/:invitationId/resend` | Organization Admin | Rotate token and resend an invitation |
| `DELETE` | `/api/admin/invitations/:invitationId` | Organization Admin | Revoke an invitation |
| `GET` | `/api/admin/website-access/:userId` | Organization Admin | Read a member's website grants |
| `PUT` | `/api/admin/website-access/:userId` | Organization Admin | Replace a member's website grants |
| `GET` | `/api/admin/websites` | Organization Admin | List organization websites and sync status |
| `GET` | `/api/admin/integrations` | Organization Admin | Read Google connection and freshness status |
| `GET` | `/api/admin/organization` | Organization Admin | Read organization settings |
| `PATCH` | `/api/admin/organization` | Organization Admin | Update organization settings |
| `GET` | `/api/admin/activity-logs` | Organization Admin | Filter and page through activity logs |
| `GET` | `/api/websites` | Signed-in organization member | List all Admin websites or employee-assigned websites |
| `POST` | `/api/websites` | Organization Admin | Create a website and queue historical imports |
| `GET` | `/api/websites/:websiteId` | Admin or assigned employee | Get authorized website and sync checkpoints |
| `POST` | `/api/websites/:websiteId/sync` | Organization Admin | Queue standard website refresh |
| `GET` | `/api/websites/:websiteId/overview` | Admin or assigned employee | Read combined stored reports |
| `GET` | `/api/websites/:websiteId/gsc` | Admin or assigned employee | Read site-level GSC daily metrics |
| `GET` | `/api/websites/:websiteId/ga4` | Admin or assigned employee | Read GA4 summary or acquisition report |
| `POST` | `/api/websites/:websiteId/traffic-acquisition/sync` | Organization Admin | Queue GA4 Traffic Acquisition refresh |
| `GET` | `/api/websites/:websiteId/gsc/keywords` | Admin or assigned employee | List tracked keywords |
| `POST` | `/api/websites/:websiteId/gsc/keywords` | Organization Admin | Add one tracked keyword |
| `DELETE` | `/api/websites/:websiteId/gsc/keywords/:keywordId` | Organization Admin | Delete keyword and its history |
| `GET` | `/api/websites/:websiteId/gsc/keywords/:keywordId/history` | Admin or assigned employee | Read stored daily keyword history |
| `POST` | `/api/websites/:websiteId/gsc/keywords/:keywordId/history/sync` | Organization Admin | Sync keyword history |
| `GET` | `/api/sync-jobs` | Organization Admin | List recent organization sync jobs |
| `GET` | `/api/sync-jobs/:jobId` | Organization Admin | Get one organization sync job |
| `POST` | `/api/sync-jobs/:jobId/retry` | Organization Admin | Requeue a failed job |

### Common path and request rules

- The backend default port is `4000`; `PORT` can override it. The checked-in frontend currently defaults to `http://localhost:5000/api`, so configure `window.API_BASE` or `PORT` to make the ports match. The API prefix is `/api`.
- Website/report/keyword URLs are scoped by website ID and authorize an Admin or a currently assigned employee after checking active organization membership. Mutating website, keyword, Google integration, and sync operations are Admin-only.
- Admin success responses use `{ "success": true, "message": "...", "data": ... }`. Most API errors use `{ "error": { "code": "...", "message": "..." } }`; `/api/admin/*` errors and invitation-acceptance errors use `{ "success": false, "message": "...", "code": "..." }`.
- Send a JSON object for `POST /api/websites`, keyword creation, keyword history sync, and Traffic Acquisition sync.
- Date-filtered website report and keyword history routes require both `startDate` and `endDate`. They are inclusive, valid calendar dates in `YYYY-MM-DD` form; maximum range is 550 days.
- Website and keyword IDs must be positive safe integers. Invalid IDs return `400`; unknown or inaccessible websites return `404`.
- JSON endpoints use the response shapes documented below. File export responses are binary attachments; do not call `response.json()` on a successful export.
- All API error responses use `{ "error": { "code": "...", "message": "..." } }`.

## 3. Authentication endpoints

### `GET /api/auth/me`

Public session check. For an authenticated Admin, it also schedules a background freshness check; it does not wait for jobs to finish. Employee sessions do not trigger Google synchronization.

Unauthenticated response:

```json
{ "authenticated": false, "user": null }
```

Authenticated response:

```json
{
  "authenticated": true,
  "user": { "id": 12, "email": null, "name": "Analyst", "username": "analyst01" },
  "membership": { "role": "analyst", "status": "active" },
  "permissions": {
    "canManageOrganization": false,
    "canCreateWebsites": false,
    "canExportReports": false
  },
  "googleConnection": {
    "connected": false
  }
}
```

Employee `email` can be `null`; employees do not connect Google accounts. Admins receive their Google connection state, while employee responses do not include OAuth credentials or tokens.

### `GET /api/auth/google`

Begin Admin Google OAuth with `window.location.assign(`${API_BASE}/auth/google`)`. Active Analyst and Viewer accounts are rejected by the OAuth callback.

### `POST /api/auth/login`

Employee username/password login. The username is case-insensitive and globally unique. Passwords must be at least 12 characters and no more than 72 UTF-8 bytes. Send `Content-Type: application/json`. The response sets the HTTP-only session cookie; do not save credentials in browser storage.

```json
{ "username": "analyst01", "password": "the employee password" }
```

Normal login response:

```json
{ "authenticated": true, "mustChangePassword": false }
```

When `mustChangePassword` is true, the frontend must show the password-change form and must not load other workspace APIs until `POST /api/auth/change-password` succeeds. Invalid credentials and disabled-account responses are generic.

### `POST /api/auth/change-password`

Used after login with a generated temporary password. The request body is `{ "password": "new password" }`; the new password must be at least 12 characters and no more than 72 UTF-8 bytes. The response is `{ "success": true, "mustChangePassword": false }` and rotates the session version.

### `POST /api/auth/logout`

Clears the session cookie. Returns `204 No Content`.

### `POST /api/auth/disconnect-google`

Admin-only. Deactivates the Admin's saved Google connection and clears the session. Returns `204 No Content`.

Because logout and disconnect return no JSON body, the shared frontend API helper must treat `204` as success without attempting `response.json()`.

### Employee account management

All employee-management endpoints require an organization Admin session.

#### `POST /api/admin/users`

Creates an Analyst or Viewer account and grants access to one or more active websites in the Admin's organization. Username is normalized to lowercase and unique across the installation. `password` is optional: if omitted, the API generates a temporary password, returns it once, and requires a change at first login.

```json
{
  "name": "Example Analyst",
  "username": "analyst01",
  "password": "optional initial password",
  "role": "analyst",
  "websiteIds": [12, 18]
}
```

`name` is required. `username` must be 3–50 characters using letters, numbers, dots, underscores, or hyphens. `websiteIds` must contain at least one unique website ID from the same organization. If `password` is omitted, the successful response's `data.temporaryPassword` contains the one-time password; copy it for the employee because it will not be returned again. Passwords and hashes are never written to activity metadata.

#### `POST /api/admin/users/:userId/password`

Generates and hashes a new temporary password, invalidates the employee's existing sessions, and requires a password change at next login. The returned `data.temporaryPassword` is shown only in this response.

#### Website grants and account status

- `GET /api/admin/website-access/:userId` lists organization websites and the employee's current grants.
- `PUT /api/admin/website-access/:userId` replaces grants using `{ "websiteIds": [12, 18] }`. Use an empty array to revoke all grants. Each report and website request checks current grants in SQL.
- `PATCH /api/admin/users/:userId/role` accepts `analyst` or `viewer` for employee password accounts. Employee accounts cannot be promoted to Admin; Admin access requires Google authentication.
- `PATCH /api/admin/users/:userId/status` activates or deactivates an account. Deactivation invalidates the account's existing sessions.
- `GET /api/admin/users` and `GET /api/admin/users/:userId` return username, role, status, assigned website IDs, and last login when available; password hashes are never included.

Migration `015_employee_password_accounts.js` backfills existing Analyst/Viewer memberships with usernames derived from their email and an unusable password hash. An Admin must reset those accounts' passwords before employees can sign in. The migration deactivates any legacy Google token record belonging to an employee, without deleting the token record.

## 4. Websites

### `GET /api/websites`

Returns active organization websites to Admins and currently assigned active websites to Analysts and Viewers, with sync checkpoint summaries.

```json
{
  "websites": [
    {
      "website_id": 12,
      "website_name": "Example",
      "domain_name": "https://example.com",
      "ga4_property_id": "123456789",
      "gsc_property_url": "sc-domain:example.com",
      "timezone": "UTC",
      "currency_code": null,
      "created_at": "2026-10-01T10:00:00.000Z",
      "active_sync_jobs": 1
    }
  ],
  "freshness": [
    {
      "websiteId": 12,
      "checkpoints": [
        {
          "source": "gsc",
          "report_type": "search_console",
          "last_successful_date": "2026-10-25",
          "last_sync_completed_at": "2026-10-26T10:00:00.000Z",
          "status": "completed"
        }
      ]
    }
  ]
}
```

Keep the selected website ID in frontend state and use it in all website-scoped requests. Keyword records are isolated by website.

### `POST /api/websites`

Adds a website and queues background historical imports. Returns `202 Accepted`.

```json
{
  "websiteName": "Example",
  "domainName": "https://example.com",
  "ga4PropertyId": "123456789",
  "gscPropertyUrl": "sc-domain:example.com",
  "timezone": "UTC",
  "currencyCode": "USD"
}
```

`websiteName` is trimmed and required (1–255 characters); `domainName` must be a URL (up to 2048 characters); `ga4PropertyId` must contain 4–20 digits. `gscPropertyUrl` is optional (up to 2048 characters); if omitted or empty, it is stored as `null` and GSC sync is skipped. `timezone` is optional and defaults to `UTC` (up to 64 characters). `currencyCode` is optional and must be exactly three characters.

Example `202 Accepted` response:

```json
{
  "website": {
    "website_id": 12,
    "owner_user_id": 7,
    "website_name": "Example",
    "domain_name": "https://example.com",
    "ga4_property_id": "123456789",
    "gsc_property_url": "sc-domain:example.com",
    "timezone": "UTC",
    "currency_code": "USD",
    "is_active": 1
  },
  "import": {
    "status": "queued",
    "jobs": [
      {
        "source": "ga4",
        "reportType": "website_summary",
        "jobId": 42,
        "alreadyQueued": false
      }
    ]
  },
  "message": "Website saved. Available history is being imported in the background."
}
```

The `website` object is the inserted database row; fields can include IDs and timestamps beyond the abbreviated example. A duplicate GA4 property for the same account returns `409 WEBSITE_ALREADY_EXISTS`. Invalid fields return `400 VALIDATION_ERROR`.

### `GET /api/websites/:websiteId`

Returns `{ "website": ..., "checkpoints": [...] }` for an Admin-accessible or employee-assigned website.

### `POST /api/websites/:websiteId/sync`

Queues a manual refresh of configured reports and returns `202 Accepted`:

```json
{
  "jobs": [
    {
      "source": "gsc",
      "reportType": "search_console",
      "jobId": 42,
      "alreadyQueued": false
    }
  ],
  "message": "Refresh jobs queued."
}
```

If an equivalent report job is already queued or running, its job ID is returned with `alreadyQueued: true`.

## 5. Keyword Tracking API

Keyword endpoints are mounted under `/api/websites/:websiteId/gsc/keywords`. Read endpoints require an Admin or a currently assigned employee; keyword creation, deletion, and history synchronization are Admin-only. Keywords are manually entered; this API does not provide suggestions or keyword discovery.

### `GET /api/websites/:websiteId/gsc/keywords`

List tracked keywords for the selected website:

```json
{
  "websiteId": 12,
  "keywords": [
    {
      "keyword_id": 81,
      "website_id": 12,
      "keyword": "digital marketing",
      "created_at": "2026-11-05T10:00:00.000Z",
      "updated_at": "2026-11-05T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

`keyword_id` is the identifier to pass to history, sync, and delete endpoints. The API returns the original normalized-for-display text in `keyword`. Duplicate detection is per website and ignores case plus repeated or surrounding whitespace.

### `POST /api/websites/:websiteId/gsc/keywords`

Add one keyword:

```http
POST /api/websites/12/gsc/keywords
Content-Type: application/json
```

```json
{ "keyword": "digital marketing" }
```

Returns `201 Created`:

```json
{
  "websiteId": 12,
  "keyword": {
    "keyword_id": 81,
    "website_id": 12,
    "keyword": "digital marketing",
    "created_at": "2026-11-05T10:00:00.000Z",
    "updated_at": "2026-11-05T10:00:00.000Z"
  }
}
```

Keyword text is trimmed, internal whitespace is collapsed, and length must be 1–500 characters. A duplicate returns `409` with code `KEYWORD_ALREADY_EXISTS`. There is no bulk-add endpoint; submit one request per keyword.

Adding a keyword stores it but does not automatically request its full historical range. The frontend should offer or trigger a history sync using its selected date range.

### `GET /api/websites/:websiteId/gsc/keywords/:keywordId/history`

Get stored daily rows for one tracked keyword:

```http
GET /api/websites/12/gsc/keywords/81/history?startDate=2026-10-01&endDate=2026-10-31
```

Response:

```json
{
  "websiteId": 12,
  "keywordId": 81,
  "dateRange": { "startDate": "2026-10-01", "endDate": "2026-10-31" },
  "rows": [
    {
      "report_date": "2026-10-01",
      "clicks": 24,
      "impressions": 410,
      "ctr": 0.0585,
      "average_position": 8.25
    }
  ]
}
```

Rows are ordered by `report_date` ascending. `report_date` is a calendar date, not a timestamp. Clicks and impressions are counts; CTR is a ratio; `average_position` is Google's Search Console average position, not an exact live ranking. Treat database numeric values as numbers at render time because SQL drivers may serialize decimals as strings.

The API returns only dates returned by Search Console and stored in the database. It does not fill missing dates or invent zero metrics. No rows is a valid response.

### `POST /api/websites/:websiteId/gsc/keywords/:keywordId/history/sync`

Fetch/re-import actual Search Console data for one keyword over an inclusive date range:

```http
POST /api/websites/12/gsc/keywords/81/history/sync
Content-Type: application/json
```

```json
{ "startDate": "2026-10-01", "endDate": "2026-10-31" }
```

The backend calls Search Analytics with:

- `dimensions: ["date", "query"]`
- `type: "web"`
- A `query` dimension filter with `operator: "equals"` and the saved keyword
- `rowLimit: 25000`, advancing `startRow` until the result page is short
- The configured website GSC property and an authorized organization Admin Google client

Response is `202 Accepted`, but this endpoint currently completes the Google fetch and database upserts during the HTTP request; it does **not** enqueue a `sync_jobs` record. The response includes counts:

```json
{
  "websiteId": 12,
  "keywordId": 81,
  "dateRange": { "startDate": "2026-10-01", "endDate": "2026-10-31" },
  "rowsFetched": 18,
  "rowsInserted": 18,
  "rowsUpdated": 0
}
```

`rowsFetched` counts returned daily rows that passed the exact-query check. Existing dates are upserted, so syncing again refreshes data that Search Console may have revised. Once the request succeeds, reload history with the same date range. If no query data is available, zero counts are valid.

This operation is limited by the shared 550-day date-range validator and by Google's available data, permissions, quotas, and retention. Google may return less history than requested.
The current sync handler returns `202` with zero row counts if the supplied `keywordId` does not match a keyword for that website; validate the selection against the keyword list before calling it. Unlike the history retrieval and deletion endpoints, it does not currently return `404` for that case.

### `DELETE /api/websites/:websiteId/gsc/keywords/:keywordId`

Delete a keyword:

```http
DELETE /api/websites/12/gsc/keywords/81
```

Response:

```json
{ "websiteId": 12, "keywordId": 81, "deleted": true }
```

The database cascades deletion to that keyword's historical rows. The route only deletes a keyword belonging to the selected website.

## 6. Keyword UI data flow

Recommended lifecycle for a Keyword Tracking view:

1. Load websites with `GET /api/websites`; require the user to select one before keyword operations.
2. Load its keywords with `GET /api/websites/:websiteId/gsc/keywords`.
3. Add a keyword with `POST`. On `409`, keep the form value and show the duplicate message.
4. Select a keyword and request stored history for the selected date range.
5. To fetch/revise data, call the history `sync` endpoint, show a busy state while the request is pending, then request history again.
6. On website/date-range/keyword change, load the appropriate list or history. Do not fetch the complete history just because the user opens the view.
7. On deletion, clear the selected history if it was the deleted keyword and reload the list.
8. Export only the currently loaded rows. The browser can generate CSV from the history response; there is no backend keyword CSV endpoint.

The supplied frontend uses the global start/end date controls for keyword history. The `Apply` button reloads history with the selected range. A separate date control can be added, but it should use the same `YYYY-MM-DD` parameters and validation.

### History chart and summaries

- Plot `report_date` on the X-axis and `average_position` on the Y-axis.
- Lower numerical position is better; place position `1` at the top and larger values lower down.
- Plot only records returned by the history API. Do not add a point for missing dates.
- Label the measure **Google Search Console average position**, not live Google rank.
- Useful range-level values can be calculated from returned rows:
  - Total clicks = sum of `clicks`.
  - Total impressions = sum of `impressions`.
  - Combined CTR = total clicks / total impressions (or unavailable when impressions are zero).
  - Latest position = the last date-ordered row's `average_position`.
  - Best/worst displayed positions can be the minimum/maximum among returned daily average-position values. Explain they are best/worst average positions in the selected stored range, not a per-search ranking guarantee.
- Average position is aggregated by Google and should not be represented as a precise rank for an individual search.

### Automatic keyword refresh

`POST /api/websites/:websiteId/sync`, website onboarding imports, and login freshness checks reuse the existing GSC `search_console` background job. During each GSC date chunk, the worker refreshes site-level GSC totals and history for all currently tracked keywords using exact query filters. The keyword rows are upserted.

Automatic refresh therefore uses the date range selected by the existing GSC sync policy (historical backfill or a recent lookback); it does not import all historical dates for a keyword on every page view. Use the per-keyword history sync endpoint for a user-selected historical range.

The tracked keyword history shares the existing GSC sync job and checkpoint; there is no separate per-keyword job status or checkpoint API. A GSC keyword fetch error can fail/retry the containing GSC job. Existing stored rows are not deleted when the Google request fails.

## 7. Existing reports and filters

All reports below require `startDate` and `endDate` in the query string unless noted. They read stored rows; they do not call Google synchronously.

### `GET /api/websites/:websiteId/overview`

Returns `website`, `dateRange`, `data`, and `sync`:

- `data.googleSearchConsole`: daily site-level GSC totals.
- `data.googleAnalytics`: daily GA4 summary rows.
- `data.trafficAcquisition.defaultChannelGroup` and `.sourceMedium`: traffic reports with totals.
- `data.userAcquisition`: stored user-acquisition report rows.
- `sync.checkpoints` and `sync.recentJobs`.

### `GET /api/websites/:websiteId/gsc`

Returns `{ websiteId, dateRange, rows }`. GSC rows contain `report_date`, `clicks`, `impressions`, `ctr`, and `average_position`. These are site-level daily totals, not keyword rows.

### `GET /api/websites/:websiteId/ga4`

`reportType` can be `summary` (default), `user_acquisition`, or `traffic_acquisition`.

- `summary`: daily organic sessions and conversion event counts. `dimensionType` is ignored.
- `user_acquisition`: `dimensionType=default_channel_group|source_medium` (defaults to `default_channel_group`).
- `traffic_acquisition`: requires `dimensionType=default_channel_group|source_medium`; the route defaults this to `default_channel_group`.

Invalid report types return `400 INVALID_REPORT_TYPE`. Invalid dimensions return `400 INVALID_DIMENSION_TYPE`.

#### Summary example

```http
GET /api/websites/12/ga4?startDate=2026-10-01&endDate=2026-10-07&reportType=summary
```

```json
{
  "websiteId": 12,
  "reportType": "summary",
  "dateRange": { "startDate": "2026-10-01", "endDate": "2026-10-07" },
  "rows": [
    {
      "report_date": "2026-10-01",
      "organic_sessions": 18,
      "form_submit_conversions": 2,
      "from_submit_conversions": 0,
      "total_form_conversions": 2
    }
  ]
}
```

Summary sessions are filtered to the GA4 `Organic Search` session default channel group. Conversion columns count the exact configured event names `form_submit` and `Form_Submit`. `total_form_conversions` is generated by the database as their sum. The rows are stored values; an absent date means the API returned no stored row for that day.

#### User Acquisition example

```http
GET /api/websites/12/ga4?startDate=2026-10-01&endDate=2026-10-07&reportType=user_acquisition&dimensionType=default_channel_group
```

```json
{
  "websiteId": 12,
  "reportType": "user_acquisition",
  "dimensionType": "default_channel_group",
  "dateRange": { "startDate": "2026-10-01", "endDate": "2026-10-07" },
  "count": 1,
  "rows": [
    {
      "date": "2026-10-01",
      "dimensionName": "firstUserDefaultChannelGroup",
      "dimensionValue": "Organic Search",
      "dimensions": {
        "date": "20261001",
        "firstUserDefaultChannelGroup": "Organic Search"
      },
      "metrics": {
        "totalUsers": 20,
        "newUsers": 12,
        "activeUsers": 18,
        "engagedSessions": 16,
        "engagementRate": 0.8,
        "averageSessionDuration": 72.5,
        "conversions": 2,
        "totalRevenue": 0
      }
    }
  ]
}
```

The actual row values and metric values depend on the GA4 property and can be empty or zero. `dimensionType=source_medium` uses the `firstUserSourceMedium` dimension. The `dimensions` and `metrics` objects preserve the GA4 field names. Convert numeric strings to numbers as needed in UI calculations. These are daily report values; summing users across dates is not a distinct-user count for the whole selected range.

#### Traffic Acquisition example

```http
GET /api/websites/12/ga4?startDate=2026-10-01&endDate=2026-10-07&reportType=traffic_acquisition&dimensionType=source_medium
```

```json
{
  "websiteId": 12,
  "reportType": "traffic_acquisition",
  "dimensionType": "source_medium",
  "dateRange": { "startDate": "2026-10-01", "endDate": "2026-10-07" },
  "count": 1,
  "rows": [
    {
      "dimensionType": "source_medium",
      "dimensionValue": "google / organic",
      "sessionDefaultChannelGroup": "Organic Search",
      "sessionSourceMedium": "google / organic",
      "sessions": 95,
      "engagedSessions": 73
    }
  ],
  "total": { "sessions": 95, "engagedSessions": 73 }
}
```

Use `dimensionValue` as the selected dimension's table label; the other dimension field may be `null`. Rows are aggregated over the requested date range and sorted by sessions descending, then dimension value. `total` is the sum of the returned rows. The route reads stored rows; refresh them through the Traffic Acquisition sync endpoint below.

### `POST /api/websites/:websiteId/traffic-acquisition/sync`

Queues a GA4 Traffic Acquisition refresh for a JSON body containing `startDate` and `endDate`:

```http
POST /api/websites/12/traffic-acquisition/sync
Content-Type: application/json
```

```json
{ "startDate": "2026-10-01", "endDate": "2026-10-07" }
```

Returns `202 Accepted`:

```json
{
  "websiteId": 12,
  "source": "ga4",
  "reportType": "traffic_acquisition",
  "dateRange": { "startDate": "2026-10-01", "endDate": "2026-10-07" },
  "jobId": 44,
  "alreadyQueued": false
}
```

The response represents queued work, unlike the per-keyword history sync endpoint. Continue showing stored report rows and use the sync activity API to monitor progress.

## 8. Sync activity

- `GET /api/sync-jobs`: Admin-only; returns `{ "jobs": [...] }`, up to the 100 most recent jobs in the organization.
- `GET /api/sync-jobs/:jobId`: Admin-only; returns `{ "job": {...} }` for a job in the organization.
- `POST /api/sync-jobs/:jobId/retry`: requeues a failed job and returns `202 Accepted`. A non-failed job returns `409 JOB_NOT_FAILED`.

Job status is `queued`, `running`, `completed`, `failed`, or `cancelled`. Records include source, report type, sync type, requested range, fetched row count, error message, and timestamps. The frontend may poll while status is `queued` or `running`, but should stop on terminal status. Keyword-specific history sync is synchronous despite returning 202 and does not appear here.

## 9. Errors and status handling

Most API errors use this shape:

```json
{
  "error": {
    "code": "INVALID_DATE",
    "message": "startDate and endDate must be valid dates in YYYY-MM-DD format."
  }
}
```

`/api/admin/*` errors and invitation-acceptance errors instead use `{ "success": false, "message": "...", "code": "..." }`. Additional route-specific codes include `INVALID_CREDENTIALS` for employee login; `PASSWORD_CHANGE_REQUIRED` for temporary-password sessions; `GOOGLE_ADMIN_ONLY` for employee Google sign-in; `VALIDATION_ERROR` and `WEBSITE_ALREADY_EXISTS` for website creation; `INVALID_REPORT_TYPE` and `INVALID_DIMENSION_TYPE` for GA4 reports; `INVALID_JOB_ID` and `JOB_NOT_FAILED` for sync job operations; and OAuth flow codes such as `OAUTH_DENIED`, `OAUTH_STATE_INVALID`, `OAUTH_ID_TOKEN_MISSING`, and `OAUTH_PROFILE_INVALID`.

Handle errors by status and `error.code` where possible:

| HTTP | Example codes | Frontend behavior |
|---|---|---|
| `400` | `INVALID_DATE`, `INVALID_DATE_RANGE`, `DATE_RANGE_TOO_LARGE`, `INVALID_KEYWORD`, `INVALID_KEYWORD_ID`, `INVALID_JOB_ID`, `INVALID_REPORT_TYPE`, `INVALID_DIMENSION_TYPE`, `VALIDATION_ERROR`, `GSC_PROPERTY_MISSING` | Show validation/configuration message; keep user input. |
| `401` | `AUTH_REQUIRED`, `INVALID_CREDENTIALS`, `GOOGLE_REAUTH_REQUIRED`, `OAUTH_DENIED`, `OAUTH_ID_TOKEN_MISSING` | For `AUTH_REQUIRED`, return to sign-in. Keep employee login errors generic. |
| `403` | `FORBIDDEN`, `GOOGLE_ADMIN_ONLY`, `GOOGLE_SCOPES_MISSING`, `PASSWORD_CHANGE_REQUIRED`, `REPORT_EXPORT_FORBIDDEN` | Hide or disable unavailable actions; force password change when requested; do not retry without permission changes. |
| `404` | `WEBSITE_NOT_FOUND`, `MEMBER_NOT_FOUND`, `KEYWORD_NOT_FOUND`, `SYNC_JOB_NOT_FOUND` | Refresh the relevant list/selection; do not show private data. |
| `409` | `KEYWORD_ALREADY_EXISTS`, `WEBSITE_ALREADY_EXISTS`, `USERNAME_ALREADY_EXISTS`, `JOB_NOT_FAILED`, `PASSWORD_CHANGE_NOT_REQUIRED` | Show the specific conflict; do not retry unchanged input automatically. |
| `429` | Rate limit | Tell the user to wait before retrying. Employee login, comparisons, exports, and sensitive Admin actions are rate-limited. |
| `413` | `REPORT_TOO_LARGE` | Narrow the date range or filters and retry. |
| `422` | `VALIDATION_ERROR`, `INVALID_COMPARISON_RANGE`, `REPORT_SOURCE_UNAVAILABLE` | Show field/source-specific guidance and preserve user selections. |
| `502` | `GSC_REQUEST_FAILED` or Google request failures | Explain the upstream request failed; allow a deliberate retry. |
| `503` | `EMAIL_NOT_CONFIGURED`, health database unavailable | Show the relevant service/configuration issue; do not imply an email invitation was sent. |
| `500` | `INTERNAL_SERVER_ERROR` | Show a generic failure; production does not reveal server details. |

`GET /health` is public and returns `{ "status": "ok", "database": "connected" }` when healthy. It returns `503` when the database check fails.

## 10. Data and security notes

- Google data is fetched by backend services using the organization's authorized Admin Google connection. Analysts and Viewers read synchronized SQL data and do not need Google credentials. Never place Google client secrets, refresh/access tokens, encryption keys, session secrets, or DB credentials in frontend files.
- The backend encrypts OAuth tokens at rest. `/api/auth/me` and the Admin integrations endpoint expose connection metadata only, never tokens.
- The Google account must have read access to each configured GA4 and GSC property. `gsc_property_url` must be the property identifier accepted by Search Console, such as `sc-domain:example.com` or the exact URL-prefix property.
- Google may return fewer dates/rows than requested due to property data availability, permissions, quotas, or retention. Empty data is not evidence that the keyword has zero performance.
- GSC position is average position reported by Search Console. It is not a live personalized SERP position.
- The backend does not offer a keyword suggestion/search endpoint. The Keyword Tracking module only manages user-entered query strings and retrieves their matching exact query performance.

## 11. Admin Panel API

All `/api/admin` endpoints are organization-scoped and require a signed-in active Admin. The backend resolves the caller's organization from the active membership; there is no client-supplied organization ID. Members can have the roles `admin`, `analyst`, or `viewer`. The last active Admin cannot be demoted, deactivated, or revoked.

### Members

`GET /api/admin/users` supports `search`, `role`, `status`, `page`, `limit` (maximum 100), `sortBy` (`name`, `email`, `role`, `status`, `joined_at`), and `order` (`asc`, `desc`). Its `data` array contains records with `id`, `name`, `email`, `username`, `isEmployeeAccount`, `role`, `status`, `joinedAt`, `lastLoginAt`, and `assignedWebsiteIds`; `pagination` contains `page`, `limit`, and `total`. Employee emails may be `null`. Password hashes are never returned.

Create an employee using `POST /api/admin/users` as described above. Existing employee accounts can switch between `analyst` and `viewer` with `PATCH /api/admin/users/:userId/role` and `{ "role": "analyst" }` or `{ "role": "viewer" }`. Employee password accounts cannot be promoted to Admin, and Google Admin membership cannot be changed into an employee account through this route. Use `PATCH /api/admin/users/:userId/status` with `{ "status": "active" }` or `{ "status": "inactive" }`. `DELETE /api/admin/users/:userId` revokes organization membership, removes website grants, and invalidates existing sessions.

### Invitations

Create a Google-authenticated Admin invitation with:

```http
POST /api/admin/users/invite
Content-Type: application/json
```

```json
{
  "email": "employee@example.com",
  "role": "admin",
  "websiteIds": [12, 14]
}
```

`role` must be `admin`; this endpoint does not create Analysts or Viewers. Use `POST /api/admin/users` for those employee accounts. `websiteIds` is optional and defaults to an empty list. SMTP must be configured (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `INVITATION_FROM_EMAIL`) or the API responds with `503 EMAIL_NOT_CONFIGURED`. The API stores only a hash of the invitation token. A delivery failure is explicitly returned as `deliveryStatus: "failed"` and the invitation can be resent after SMTP is fixed. List and detail responses never return the raw token.

Invitees must authenticate with the invited Google account and send `POST /api/auth/invitations/accept` with `{ "token": "<invitation token>" }`. The token is single-use, expires according to the organization policy, and is checked against the signed-in account's email. A user with an active membership in another organization cannot accept an invitation because the current session architecture does not provide organization selection.

### Website access, integrations, settings, and activity

- `GET /api/admin/website-access/:userId` returns the member's grants for organization websites. Replace grants with `PUT` and `{ "websiteIds": [12, 14] }`; every ID must belong to the same organization.
- `GET /api/admin/websites` returns organization website configuration and active sync-job counts.
- `GET /api/admin/integrations` returns connection owner, Google account, connection state/error, token refresh time, and last successful sync. It never returns OAuth tokens.
- `GET /api/admin/organization` returns organization settings. `PATCH` accepts one or more of `name`, `defaultTimezone`, `reportExportsEnabled`, `viewerExportsEnabled`, and `invitationExpiryHours` (`1`–`720`). Viewer exports default to disabled.
- `GET /api/admin/activity-logs` supports `actorUserId`, `action`, `resourceType`, `startDate`, `endDate`, `page`, `limit`, and `order`. Date filters use inclusive calendar days. Activity metadata contains operational details only, not passwords, OAuth credentials, or raw invitation tokens.

Admin operations return the standard success envelope. Errors include `AUTH_REQUIRED` (`401`), `ORGANIZATION_MEMBERSHIP_REQUIRED` or `FORBIDDEN` (`403`), `VALIDATION_ERROR` (`422`), and conflict codes such as `LAST_ACTIVE_ADMIN`, `INVITATION_ALREADY_EXISTS`, and `ORGANIZATION_MEMBERSHIP_EXISTS` (`409`).

## 12. Report comparisons and exports

Both endpoints use the existing session cookie, active organization membership, and website-level access checks. The API resolves organization context on the server; clients must not send organization IDs or permission claims. Report comparison is limited to 60 requests per user per 15 minutes; exports are limited to 10 requests per user per 15 minutes.

### `GET /api/websites/:websiteId/reports/comparison`

Compares stored report data for two ranges. Required parameters are `source`, `currentStartDate`, and `currentEndDate`. Provide both `compareStartDate` and `compareEndDate` for an exact custom range, or omit both to use `comparisonMode`.

Supported `source` values:

- `gsc`: site-level Search Console rows.
- `ga4`: daily organic sessions and form conversions.
- `user_acquisition`: stored first-user acquisition rows.
- `traffic_acquisition`: stored sessions by channel or source/medium.
- `keyword_tracking`: daily query history. Add `filters={"keywordId":81}` or `filters={"keyword":"digital marketing"}` to compare one keyword's rank. Position is compared using the latest available row in each period.
- `combined`: daily GSC and GA4 summary rows combined by their actual date.

Landing-page and visitor-entry sources are not available: the verified database has no persisted table for those reports. Requests for them return `422 REPORT_SOURCE_UNAVAILABLE`, not fabricated data.

Optional parameters:

- `metrics`: comma-separated allowed metric names. If omitted, all metrics for the selected source are returned.
- `dimensions` or `groupBy`: comma-separated allowed dimensions. If both are supplied, they must match. Dimensions are source-specific and the API rejects unsupported names.
- `filters`: URL-encoded JSON object. `traffic_acquisition` and `user_acquisition` support `dimensionType` (`default_channel_group` or `source_medium`) and `dimensionValue`; `keyword_tracking` supports `keywordId` or `keyword`.
- `comparisonMode`: `previous_period` (default), `previous_week`, `previous_month`, or `previous_year`. Custom ranges use explicit compare dates.
- `sortBy`: an allowed metric or dimension. `order`: `asc` or `desc`.

Calendar comparison rules use inclusive `YYYY-MM-DD` dates (maximum 550 days per range). `previous_period` uses the immediately preceding equal number of calendar days. `previous_week` requires a Monday-starting current period of at most seven days and compares the same weekdays of the prior week. `previous_month` requires a current range starting on the first of a month and compares month-to-date against the prior month, clamping the final day when month lengths differ. `previous_year` requires a range starting January 1 and compares year-to-date against the same dates in the prior year, clamping February 29 to February 28. Calendar dates are not shifted; organization timezone is returned as metadata. Custom ranges must not overlap.

Example:

```http
GET /api/websites/12/reports/comparison?source=gsc&currentStartDate=2026-11-01&currentEndDate=2026-11-17&compareStartDate=2026-10-15&compareEndDate=2026-10-31&metrics=clicks,impressions,ctr,average_position
```

Response shape:

```json
{
  "success": true,
  "filters": { "websiteId": 12, "source": "gsc", "metrics": ["clicks", "impressions", "ctr", "average_position"], "dimensions": ["date"], "groupBy": ["date"], "filters": {} },
  "comparisonMode": "custom",
  "periods": {
    "current": { "startDate": "2026-11-01", "endDate": "2026-11-17" },
    "comparison": { "startDate": "2026-10-15", "endDate": "2026-10-31" }
  },
  "summary": {
    "clicks": { "currentValue": 1250, "previousValue": 1000, "absoluteChange": 250, "percentageChange": 25, "trend": "up" }
  },
  "data": {
    "current": [{ "date": "2026-11-01", "clicks": 72, "impressions": 410, "ctr": 0.1756, "average_position": 8.3 }],
    "comparison": [{ "date": "2026-10-15", "clicks": 54, "impressions": 390, "ctr": 0.1385, "average_position": 9.1 }]
  },
  "metadata": { "generatedAt": "2026-11-17T06:00:00.000Z", "timezone": "UTC" }
}
```

Values above illustrate the response shape only. Actual values are read from persisted records. Percentage change is `null` when the previous value is zero or either period has no usable value. CTR is computed from period clicks divided by period impressions; average position is impression-weighted for GSC, and keyword rank uses each period's latest observation. Engagement rate uses combined engaged sessions divided by sessions. User-acquisition total/active users are unavailable as period-level distinct counts and therefore return `null` in the summary rather than summing daily users. Position `trend` describes its numeric movement; `performanceTrend` indicates improvement when the average position decreases.

### `GET /api/websites/:websiteId/reports/export`

Exports the same persisted report sources and metric fields as the comparison/report services. Required parameters are `source`, `startDate`, and `endDate`. `format` is `csv` (default) or `xlsx`; supported metrics, dimensions, and filters follow the comparison endpoint. `sortBy` and `order` control row order. CSV uses UTF-8, escapes CSV syntax, and neutralizes formula-leading untrusted text. XLSX files contain a title, website, reporting period, typed date/number cells, and formatted percentage metrics. Export datasets are bounded to 20,000 rows; larger results return `413 REPORT_TOO_LARGE` and can be narrowed with dates or filters.

Example CSV:

```http
GET /api/websites/12/reports/export?source=gsc&startDate=2026-11-01&endDate=2026-11-17&format=csv&metrics=clicks,impressions,ctr&dimensions=date
```

Example XLSX:

```http
GET /api/websites/12/reports/export?source=traffic_acquisition&startDate=2026-11-01&endDate=2026-11-17&format=xlsx&filters=%7B%22dimensionType%22%3A%22source_medium%22%7D
```

Successful requests return a file attachment with a safe generated filename. CSV content type is `text/csv; charset=utf-8`; XLSX content type is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Empty datasets return a valid header-only file.

Export permissions are checked against the database on every request:

- Admin: may export for an authorized website regardless of organization export policy.
- Analyst: may export when the organization setting `reportExportsEnabled` is true.
- Viewer: denied by default; may export only when the Admin enables `viewerExportsEnabled` through `PATCH /api/admin/organization`.

`viewerExportsEnabled` is stored in migration `014_viewer_report_exports.js` and defaults to false. Apply pending migrations with `npm run migrate`; rollback this migration with `npm run migrate -- rollback 014_viewer_report_exports.js`. Rollback is guarded and refuses to remove the setting while any organization has Viewer exports enabled. Successful file generation writes only the organization, actor, website, source, format, selected date range, metrics, and dimensions to `activity_logs`; report contents and credentials are not logged. Temporary files are cleaned after the response or generation failure.

Errors use the standard `{ "error": { "code": "...", "message": "..." } }` envelope before file streaming. Relevant codes include `INVALID_DATE`, `INVALID_DATE_RANGE`, `DATE_RANGE_TOO_LARGE`, `INVALID_SOURCE`, `REPORT_SOURCE_UNAVAILABLE`, `INVALID_REPORT_TYPE`, `INVALID_DIMENSION_TYPE`, `INVALID_COMPARISON_MODE`, `INVALID_COMPARISON_RANGE`, `REPORT_EXPORT_FORBIDDEN`, `REPORT_TOO_LARGE`, and `XLSX_GENERATION_FAILED`.
