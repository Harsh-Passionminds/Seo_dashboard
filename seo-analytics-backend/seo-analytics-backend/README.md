# SEO Analytics Backend

Express + MySQL/MariaDB backend for the SEO Analytics static HTML/CSS/JavaScript frontend. It uses real Google OAuth 2.0, GA4 Data API, and Search Console API integrations. No analytics mock data is returned.

## What is included

- Admin Google OAuth login, state validation, encrypted token persistence, signed HttpOnly session cookie, logout and `/api/auth/me`.
- Admin-managed Analyst and Viewer accounts with bcrypt password hashes, temporary-password change on first login, and website-scoped access.
- Organization Admin access to all organization websites; employee access is rechecked against current website grants for every request.
- Admin-only user, integration, website, and synchronization management. Employee exports follow the organization role policy.
- DB-only date-filtered reports: overview, GSC, GA4 summary, User Acquisition and Traffic Acquisition.
- Website onboarding with background historical jobs for the prior 16 months (or whatever history Google makes available).
- Admin OAuth login and session checks schedule background freshness checks; employee report requests read stored data and do not call Google.
- DB-backed `sync_jobs` and `sync_checkpoints`, retry-safe upserts, 30-day chunks, and a polling worker.
- Initial MySQL migration and date-range tests.

## Important verified limitations / configuration decisions

1. **Database engine:** the connected development database was verified as MariaDB 10.4.32. Confirm the exact production engine/version and take a backup before applying pending migrations.
2. **Google properties:** the Google account must have read access to each GA4 property and Search Console property. `gsc_property_url` must be the exact GSC property identifier, e.g. `sc-domain:example.com` is not interchangeable with `https://example.com/`; use the value accepted by the Search Console API for the property.
3. **History:** the code requests up to 16 months, but APIs can return less history, and GA4 retention/property configuration can limit what is available. “16 months” is the requested window, not a guarantee that Google has every row.
4. **GA4 fields:** the field sets are explicit in `src/services/ga4.service.js`. GA4 dimension/metric compatibility varies; if a property/API rejects a combination, the job is marked failed with an error summary instead of storing fabricated values.
5. **GSC granularity:** the current `google_search_console_data` table stores daily site-level totals only, matching the agreed schema. Query/page/country/device breakdowns need extra dimensions and a different unique key/schema.
6. **Worker hosting:** this implementation uses a polling worker inside the Node process. Hostinger must keep the backend process alive. If the deployment sleeps/restarts or does not support a persistent process, use a supported scheduler/worker arrangement; the code does not claim Hostinger capability has been verified.
7. **Session model:** this implementation uses a shared server-side-validated session cookie. Employee credentials and website grants are stored separately from Google tokens. Use the existing versioned migrations for an existing database; do not drop or recreate populated tables.
8. **Security:** access/refresh tokens are encrypted with AES-256-GCM before DB storage. Set a stable 32-byte `TOKEN_ENCRYPTION_KEY_HEX` and `SESSION_JWT_SECRET`. Back up the encryption key securely; losing it makes stored tokens unreadable. Use HTTPS in production.
9. **OAuth callback:** configure the same `GOOGLE_REDIRECT_URI` in Google Cloud Console. Required scopes are `openid`, `email`, `profile`, Analytics read-only and Search Console read-only. Configure OAuth consent and authorized origins as required by your Google project.
10. The current schema includes organization access (`organizations`, `organization_members`, `website_permissions`, `employee_credentials`, invitations, and activity logs), Google identity/token tables, website credentials, persisted GSC/GA4/acquisition analytics, and sync job/checkpoint tables. `acquisition_report_data` is a superseded unused table and is removed by migration `005_drop_unused_acquisition_report_data.sql`.

## Setup

1. Confirm the target database engine/version and use a least-privilege DB user. For an existing populated database, verify its migration history and take a backup; do not replace it with an empty database or run the initial schema over existing records.
2. Copy `.env.example` to `.env` and fill every secret/config value. Never commit `.env`.
3. Install Node.js 20+ and dependencies:

   ```bash
   npm install
   ```

4. Back up the database and stop the running backend before applying pending authentication/schema migrations:

   ```bash
   npm run migrate
   ```

   The migration runner records applied migrations and skips them on later runs. It refuses to adopt a non-empty database with no migration history. If the existing database predates migration tracking, verify its schema manually before baselining; do not reinitialize a populated database:

   ```sql
   CREATE TABLE schema_migrations (
     migration_name VARCHAR(255) NOT NULL PRIMARY KEY,
     applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

   INSERT INTO schema_migrations (migration_name)
   VALUES ('001_initial_schema.sql');
   ```

   After that verified baseline, `npm run migrate` applies pending migrations, including `015_employee_password_accounts.js` for employee login.

   Migration `005_drop_unused_acquisition_report_data.sql` permanently drops the obsolete `acquisition_report_data` table. Back up any existing rows from that table first if they are needed. The separate `traffic_acquisition_data_legacy` table is intentionally retained as an archive; it is not queried by the current API.

5. Start the API and worker:

   ```bash
   npm run dev
   ```

6. The supplied plain frontend currently defaults to `http://localhost:5000/api`, while the backend defaults to port `4000`. Set `window.API_BASE` or `PORT` so they match. The React/Vite frontend defaults to `http://localhost:5173` and proxies `/api` requests to port `4000`; set the backend `FRONTEND_URL` to the frontend origin so Google OAuth returns to the correct app. CORS allows `FRONTEND_URL` plus the Vite localhost origins in development, including credentialed `PATCH` requests. See [FRONTEND_API.md](./FRONTEND_API.md) for deployment details.
7. Open the frontend. Organization Admins choose Google sign-in; Analysts and Viewers use the username and password provisioned by an Admin. A generated temporary password must be changed at first login.

## API routes

The frontend developer guide, including startup/login flow, role-aware UI guidance, routes, request parameters, response shapes, exports, and errors, is in [FRONTEND_API.md](./FRONTEND_API.md).

- `GET /health`
- `GET /api/auth/google` — start Admin OAuth
- `GET /api/auth/google/callback` — OAuth callback
- `POST /api/auth/login` — employee username/password login
- `POST /api/auth/change-password` — required temporary-password change
- `GET /api/auth/me` — session status; schedules freshness checks for an authenticated Admin
- `POST /api/auth/logout`
- `POST /api/admin/users` — create Analyst or Viewer account with website grants
- `POST /api/admin/users/:userId/password` — reset employee password (returns one-time temporary password)
- `PUT /api/admin/website-access/:userId` — replace employee website grants
- `GET /api/websites`
- `POST /api/websites` — body: `{ "websiteName": "...", "domainName": "https://example.com", "ga4PropertyId": "123456789", "gscPropertyUrl": "sc-domain:example.com" }`
- `GET /api/websites/:id`
- `GET /api/websites/:id/overview?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/websites/:id/gsc?startDate=...&endDate=...`
- `GET /api/websites/:id/ga4?reportType=traffic_acquisition&dimensionType=default_channel_group|source_medium&startDate=...&endDate=...` — stored rows and range totals
- `GET /api/websites/:id/ga4?reportType=summary|user_acquisition&dimensionType=default_channel_group|source_medium&startDate=...&endDate=...`
- `GET /api/websites/:id/keywords/report?startDate=...&endDate=...&search=...&sort=...&page=...&limit=...` — unified, paginated keyword report
- `POST /api/websites/:id/traffic-acquisition/sync` — queue a traffic acquisition refresh; JSON body: `{ "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }`
- `POST /api/websites/:id/sync` — queue missing/recent refresh
- `GET /api/sync-jobs/status` and `/api/sync-jobs` — Admin-only per-source synchronization status and history
- `POST /api/sync-jobs/:jobId/retry` — Admin-only; creates a new attempt while preserving the failed job record

All report endpoints read from the database. They do not call Google synchronously during a dashboard request. When a sync is queued, the API returns existing stored data and the job status can be polled.

## Data behavior

- Adding a website queues independent jobs for GA4 summary, User Acquisition, Traffic Acquisition and GSC.
- Each traffic acquisition job fetches `sessionDefaultChannelGroup` and `sessionSourceMedium` with `sessions` and `engagedSessions` for each historical or incremental date chunk.
- To read a channel report, request `GET /api/websites/:id/ga4?reportType=traffic_acquisition&dimensionType=default_channel_group&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`. Use `dimensionType=source_medium` for the source/medium report. Both responses include `count`, dimension-specific rows, and a `total` of sessions and engaged sessions for the requested date range.
- Traffic acquisition is stored in `ga4_traffic_acquisition_data`. Migration `003_create_consolidated_traffic_acquisition.sql` copies compatible legacy rows into it. After validation, migration `004_archive_legacy_traffic_acquisition.sql` renames the old table to `traffic_acquisition_data_legacy` rather than deleting it, retaining its additional historical metrics for rollback/reference. The old table name is not used by the new API or worker.
- Initial date range starts 16 calendar months before yesterday and ends yesterday.
- Historical imports process in configurable chunks; each successful chunk advances the checkpoint.
- Login/home freshness check uses the last successful sync timestamp and source-specific lookback. A missing checkpoint triggers historical backfill; stale data triggers a bounded recent refresh.
- Existing data is preserved when Google API calls fail.
- GA4 User Acquisition remains in `user_acquisition_data`. Traffic Acquisition uses `ga4_traffic_acquisition_data`, with a dimension type in its unique key so channel-group and source/medium rows cannot collide. `traffic_acquisition_data_legacy` remains available for rollback/reference; the current API and sync worker do not use it. The obsolete `acquisition_report_data` table is removed by migration 005.
- GSC CTR and GA4 engagement rate are stored as ratios; multiply by 100 when displaying as percentages.
- `total_form_conversions` is a generated sum of the two event counts in the daily summary table. Confirm `form_submit` and `From_submit` are distinct actual GA4 event names before relying on both.

## Example report request

```http
GET /api/websites/1/overview?startDate=2026-09-01&endDate=2026-09-30
Cookie: seo_session=...
```

The response is JSON with the requested date range, stored GSC rows, GA4 daily rows, and sync freshness metadata. It does not contain access tokens.

## Tests and checks

Run:

```bash
npm test
node --check src/server.js
```

The tests cover date utilities and isolated GA4 synchronization behavior, including pagination, validation, upserts, rollback, quota errors, and stored-data retrieval. Live Google API access, database connectivity, OAuth callback, and Hostinger deployment require your credentials/environment and are **not tested by this package alone**.
