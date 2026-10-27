# SEO Analytics Backend

Express + MySQL backend for the SEO Analytics React frontend. It uses real Google OAuth 2.0, GA4 Data API, and Search Console API integrations. No analytics mock data is returned.

## What is included

- Google OAuth login, state validation, encrypted token persistence, signed HttpOnly session cookie, logout and `/api/auth/me`.
- Website CRUD basics and owner-scoped access.
- DB-only date-filtered reports: overview, GSC, GA4 summary, User Acquisition and Traffic Acquisition.
- Website onboarding with background historical jobs for the prior 16 months (or whatever history Google makes available).
- Incremental freshness checks at login and when listing websites.
- DB-backed `sync_jobs` and `sync_checkpoints`, retry-safe upserts, 30-day chunks, and a polling worker.
- Initial MySQL migration and date-range tests.

## Important verified limitations / configuration decisions

1. **Database engine:** this migration targets MySQL 8.0+ and InnoDB. Confirm the exact Hostinger engine/version before running it. It is not a claim that your Hostinger plan has been verified.
2. **Google properties:** the Google account must have read access to each GA4 property and Search Console property. `gsc_property_url` must be the exact GSC property identifier, e.g. `sc-domain:example.com` is not interchangeable with `https://example.com/`; use the value accepted by the Search Console API for the property.
3. **History:** the code requests up to 16 months, but APIs can return less history, and GA4 retention/property configuration can limit what is available. “16 months” is the requested window, not a guarantee that Google has every row.
4. **GA4 fields:** the field sets are explicit in `src/services/ga4.service.js`. GA4 dimension/metric compatibility varies; if a property/API rejects a combination, the job is marked failed with an error summary instead of storing fabricated values.
5. **GSC granularity:** the current `google_search_console_data` table stores daily site-level totals only, matching the agreed schema. Query/page/country/device breakdowns need extra dimensions and a different unique key/schema.
6. **Worker hosting:** this implementation uses a polling worker inside the Node process. Hostinger must keep the backend process alive. If the deployment sleeps/restarts or does not support a persistent process, use a supported scheduler/worker arrangement; the code does not claim Hostinger capability has been verified.
7. **Session model:** this implementation is multi-user and stores `owner_user_id` on websites. Existing database tables must be migrated to match `migrations/001_initial_schema.sql`; do not run this on an existing populated schema without a backup and a migration plan.
8. **Security:** access/refresh tokens are encrypted with AES-256-GCM before DB storage. Set a stable 32-byte `TOKEN_ENCRYPTION_KEY_HEX` and `SESSION_JWT_SECRET`. Back up the encryption key securely; losing it makes stored tokens unreadable. Use HTTPS in production.
9. **OAuth callback:** configure the same `GOOGLE_REDIRECT_URI` in Google Cloud Console. Required scopes are `openid`, `email`, `profile`, Analytics read-only and Search Console read-only. Configure OAuth consent and authorized origins as required by your Google project.
10. The migration has 8 application tables plus the 2 sync tables? The exact tables are: `users`, `website_credentials`, `google_oauth_tokens`, `google_search_console_data`, `google_analytics_data`, `user_acquisition_data`, `traffic_acquisition_data`, `sync_jobs`, `sync_checkpoints` — nine tables. The user-approved 5 analytics/config tables plus OAuth and 2 sync tables require `users` as the account identity table.

## Setup

1. Confirm the Hostinger database engine/version and create an empty database plus a least-privilege DB user.
2. Copy `.env.example` to `.env` and fill every secret/config value. Never commit `.env`.
3. Install Node.js 20+ and dependencies:

   ```bash
   npm install
   ```

4. Apply the versioned migrations to an **empty database**:

   ```bash
   npm run migrate
   ```

   The migration runner records applied SQL files in `schema_migrations` and skips them on later runs. It refuses to adopt a non-empty database with no migration history. If a database already has the exact schema created by `001_initial_schema.sql` but predates migration tracking, verify it manually before baselining; only then create the migration history table and record the initial schema:

   ```sql
   CREATE TABLE schema_migrations (
     migration_name VARCHAR(255) NOT NULL PRIMARY KEY,
     applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

   INSERT INTO schema_migrations (migration_name)
   VALUES ('001_initial_schema.sql');
   ```

   After that verified baseline, `npm run migrate` applies the acquisition and consolidated traffic migrations.

5. Start the API and worker:

   ```bash
   npm run dev
   ```

6. Set the frontend's `VITE_API_BASE_URL=http://localhost:4000/api`. The frontend fetch helper should use `credentials: "include"` (the supplied starter frontend already does).
7. Open the frontend and choose Sign in with Google. The backend callback sets the cookie and redirects to `FRONTEND_URL/`.

## API routes

- `GET /health`
- `GET /api/auth/google` — start OAuth
- `GET /api/auth/google/callback` — OAuth callback
- `GET /api/auth/me` — session status; also schedules freshness checks for the user's websites
- `POST /api/auth/logout`
- `GET /api/websites`
- `POST /api/websites` — body: `{ "websiteName": "...", "domainName": "https://example.com", "ga4PropertyId": "123456789", "gscPropertyUrl": "sc-domain:example.com" }`
- `GET /api/websites/:id`
- `GET /api/websites/:id/overview?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/websites/:id/gsc?startDate=...&endDate=...`
- `GET /api/websites/:id/ga4?reportType=traffic_acquisition&dimensionType=default_channel_group|source_medium&startDate=...&endDate=...` — stored rows and range totals
- `GET /api/websites/:id/ga4?reportType=summary|user_acquisition&dimensionType=default_channel_group|source_medium&startDate=...&endDate=...`
- `POST /api/websites/:id/traffic-acquisition/sync` — queue a traffic acquisition refresh; JSON body: `{ "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }`
- `POST /api/websites/:id/sync` — queue missing/recent refresh
- `GET /api/sync-jobs/:jobId` — only jobs for the signed-in user's websites

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
- GA4 User Acquisition remains in its existing table. Traffic Acquisition uses a consolidated table with a dimension type in its unique key, so channel-group and source/medium rows cannot collide. The unused `acquisition_report_data` table is left untouched to avoid deleting unrelated or unverified legacy data.
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
