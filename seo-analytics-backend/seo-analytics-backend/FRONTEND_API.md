# SEO Analytics frontend API guide

This is the API contract for the plain JavaScript frontend and other clients integrating with this backend. The backend owns authentication, Google API access, synchronization, and database access. The browser must not call Google APIs directly, handle Google OAuth tokens, or connect to MySQL.

## 1. Local setup and API base URL

The default local API base URL is:

```text
http://localhost:4000/api
```

Run the backend from `seo-analytics-backend/seo-analytics-backend`:

```powershell
npm install
npm run migrate
npm run dev
```

Serve the frontend with VS Code Live Server or a static web server. The backend does not serve the frontend files.

The supplied frontend reads `window.API_BASE` before loading `js/app.js`. Set it in `index.html` when the API uses a different origin:

```html
<script>window.API_BASE = "https://api.example.com/api";</script>
<script src="./js/app.js"></script>
```

Set backend `FRONTEND_URL` to the frontend origin. CORS allows that origin, plus `http://localhost:5500` and `http://127.0.0.1:5500` for local development.

## 2. Authentication, ownership, and request conventions

- Start sign-in by navigating the browser to `GET /api/auth/google`. Do not fetch this URL; it redirects to Google's consent screen.
- On successful OAuth callback the backend sets an HTTP-only `seo_session` cookie and redirects to `FRONTEND_URL`.
- Include `credentials: "include"` in browser `fetch` calls. The cookie is not available to JavaScript and must not be copied into local storage.
- Send JSON requests with `Content-Type: application/json`.
- Website and report routes require a signed-in session. Website IDs are checked against the signed-in user's ownership; use the `website_id` returned by the API.
- Dates use `YYYY-MM-DD`, and ranges include both start and end dates. The shared date validator rejects invalid, reversed, or more-than-550-day ranges.
- GSC CTR is a ratio: `0.025` represents `2.5%`. For multiple days, calculate combined CTR as summed clicks divided by summed impressions; do not average daily CTRs.
- Empty arrays mean no rows are stored for the requested period. Do not generate placeholder metrics or missing date rows.

Recommended request helper:

```js
const API_BASE = (window.API_BASE || "http://localhost:4000/api").replace(/\/$/, "");

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  if (response.status === 204) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(
      typeof body === "object"
        ? body?.error?.message || body?.message || `HTTP ${response.status}`
        : body || `HTTP ${response.status}`
    );
  }
  return body;
}
```

## 3. Authentication endpoints

### `GET /api/auth/me`

Public session check. When authenticated, it also schedules a background freshness check; it does not wait for jobs to finish.

Unauthenticated response:

```json
{ "authenticated": false, "user": null }
```

Authenticated response:

```json
{
  "authenticated": true,
  "user": { "id": 12, "email": "analyst@example.com", "name": "Analyst" },
  "googleConnection": {
    "connected": true,
    "email": "analyst@example.com",
    "error": null
  }
}
```

### `GET /api/auth/google`

Begin Google OAuth with `window.location.assign(`${API_BASE}/auth/google`)`.

### `POST /api/auth/logout`

Clears the session cookie. Returns `204 No Content`.

### `POST /api/auth/disconnect-google`

Deactivates the saved Google connection and clears the session. Returns `204 No Content`.

## 4. Websites

### `GET /api/websites`

Returns active websites owned by the signed-in user and sync checkpoint summaries.

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

`websiteName`, `domainName`, and a numeric GA4 property ID are required. The GSC property can be empty if Search Console is not configured.

### `GET /api/websites/:websiteId`

Returns `{ "website": ..., "checkpoints": [...] }` for an owned website.

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

Keyword endpoints are mounted under `/api/websites/:websiteId/gsc/keywords`. They require a signed-in owner of that website. Keywords are manually entered; this API does not provide suggestions or keyword discovery.

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
- The configured website GSC property and the signed-in user's existing authorized Google client

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

- `summary`: daily organic sessions and conversion event counts.
- `user_acquisition`: requires/accepts `dimensionType=default_channel_group|source_medium`.
- `traffic_acquisition`: requires/accepts the same dimension type and returns dimension rows plus range totals.

The supplied API contract and field sets are detailed in `src/services/ga4.service.js`. Use the response values and field names rather than assuming GA4 numeric fields are all integers.

### `POST /api/websites/:websiteId/traffic-acquisition/sync`

Queues a GA4 Traffic Acquisition refresh for a JSON body containing `startDate` and `endDate`. Returns `202 Accepted`; continue showing stored data and use the sync activity view to monitor progress.

## 8. Sync activity

- `GET /api/sync-jobs`: returns `{ "jobs": [...] }`, up to the 100 most recent jobs for the signed-in user's websites.
- `GET /api/sync-jobs/:jobId`: returns `{ "job": {...} }` for an owned job.
- `POST /api/sync-jobs/:jobId/retry`: requeues a failed job and returns `202 Accepted`. A non-failed job returns `409 JOB_NOT_FAILED`.

Job status is `queued`, `running`, `completed`, `failed`, or `cancelled`. Records include source, report type, sync type, requested range, fetched row count, error message, and timestamps. The frontend may poll while status is `queued` or `running`, but should stop on terminal status. Keyword-specific history sync is synchronous despite returning 202 and does not appear here.

## 9. Errors and status handling

Error responses use this shape:

```json
{
  "error": {
    "code": "INVALID_DATE",
    "message": "startDate and endDate must be valid dates in YYYY-MM-DD format."
  }
}
```

Handle errors by status and `error.code` where possible:

| HTTP | Example codes | Frontend behavior |
|---|---|---|
| `400` | `INVALID_DATE`, `INVALID_DATE_RANGE`, `DATE_RANGE_TOO_LARGE`, `INVALID_KEYWORD`, `INVALID_KEYWORD_ID`, `GSC_PROPERTY_MISSING` | Show validation/configuration message; keep user input. |
| `401` | `AUTH_REQUIRED`, `GOOGLE_REAUTH_REQUIRED` | Ask the user to sign in or reconnect Google. |
| `403` | `GOOGLE_SCOPES_MISSING` | Ask the user to reconnect and grant required read permissions. |
| `404` | `WEBSITE_NOT_FOUND`, `KEYWORD_NOT_FOUND`, `SYNC_JOB_NOT_FOUND` | Refresh the relevant list/selection; do not show private data. |
| `409` | `KEYWORD_ALREADY_EXISTS`, `WEBSITE_ALREADY_EXISTS`, `JOB_NOT_FAILED` | Show the specific conflict; do not retry unchanged input automatically. |
| `502` | `GSC_REQUEST_FAILED` or Google request failures | Explain the upstream request failed; allow a deliberate retry. |
| `503` | health database unavailable | Show backend/database unavailable state. |
| `500` | `INTERNAL_SERVER_ERROR` | Show a generic failure; production does not reveal server details. |

`GET /health` is public and returns `{ "status": "ok", "database": "connected" }` when healthy. It returns `503` when the database check fails.

## 10. Data and security notes

- All Google data must be fetched by backend services using the user's existing OAuth authorization. Never place Google client secrets, refresh/access tokens, encryption keys, session secrets, or DB credentials in frontend files.
- The backend encrypts OAuth tokens at rest and exposes only connection status through `/auth/me`.
- The Google account must have read access to each configured GA4 and GSC property. `gsc_property_url` must be the property identifier accepted by Search Console, such as `sc-domain:example.com` or the exact URL-prefix property.
- Google may return fewer dates/rows than requested due to property data availability, permissions, quotas, or retention. Empty data is not evidence that the keyword has zero performance.
- GSC position is average position reported by Search Console. It is not a live personalized SERP position.
- The backend does not offer a keyword suggestion/search endpoint. The Keyword Tracking module only manages user-entered query strings and retrieves their matching exact query performance.
