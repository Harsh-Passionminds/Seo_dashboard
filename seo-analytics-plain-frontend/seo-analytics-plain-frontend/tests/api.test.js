import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const clientSource = await readFile(new URL("../js/api.js", import.meta.url), "utf8");

function createHarness(fetchImpl = async () => {}) {
  const window = {
    API_BASE: "http://localhost:4000/api",
    location: { href: "http://localhost:5500/" },
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    document: {
      body: { appendChild() {} },
      createElement() {
        return { click() {}, remove() {} };
      }
    }
  };
  vm.runInNewContext(clientSource, { window, URL, URLSearchParams, AbortController, setTimeout, clearTimeout });
  return window.ApiClient;
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || (name === "content-type" ? "application/json" : null) },
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); }
  };
}

test("API client includes credentials, encodes query values, and parses JSON", async () => {
  let request;
  const { createApiClient } = createHarness(async (url, options) => {
    request = { url, options };
    return jsonResponse({ ok: true });
  });
  const client = createApiClient();
  assert.deepEqual(await client.request("/websites", {
    query: { startDate: "2026-11-01", filters: { dimensionType: "source_medium" } }
  }), { ok: true });
  assert.equal(new URL(request.url).searchParams.get("startDate"), "2026-11-01");
  assert.equal(new URL(request.url).searchParams.get("filters"), '{"dimensionType":"source_medium"}');
  assert.equal(request.options.credentials, "include");
});

test("API client handles 204 responses without parsing a body", async () => {
  const { createApiClient } = createHarness(async () => ({
    ok: true,
    status: 204,
    headers: { get: () => null }
  }));
  assert.equal(await createApiClient().request("/auth/logout", { method: "POST" }), null);
});

test("API client maps API errors and notifies the session handler for 401", async () => {
  let expired = 0;
  const { createApiClient, ApiError } = createHarness(async () =>
    jsonResponse({ error: { code: "REPORT_EXPORT_FORBIDDEN", message: "Export disabled." } }, { status: 403 })
  );
  const client = createApiClient({
    fetchImpl: async () => jsonResponse({ error: { code: "AUTH_REQUIRED", message: "Sign in." } }, { status: 401 }),
    onUnauthorized: () => { expired += 1; }
  });
  await assert.rejects(client.request("/auth/me"), (error) =>
    error instanceof ApiError && error.status === 401 && /session has expired/i.test(error.message)
  );
  assert.equal(expired, 1);
  const forbidden = createApiClient({ fetchImpl: async () =>
    jsonResponse({ error: { code: "REPORT_EXPORT_FORBIDDEN", message: "Export disabled." } }, { status: 403 })
  });
  await assert.rejects(forbidden.request("/reports/export"), (error) =>
    error.status === 403 && error.code === "REPORT_EXPORT_FORBIDDEN" && error.message === "Export disabled."
  );
});

test("API client translates network failures and timeouts", async () => {
  const { createApiClient } = createHarness(async () => { throw new Error("offline"); });
  await assert.rejects(createApiClient().request("/websites"), (error) => error.code === "NETWORK_ERROR");

  const stalled = createApiClient({
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
    )
  });
  await assert.rejects(stalled.request("/websites", { timeoutMs: 1 }), (error) =>
    error.code === "REQUEST_TIMEOUT"
  );
});

test("download filename parsing supports quoted and RFC 5987 headers safely", () => {
  const { filenameFromDisposition } = createHarness();
  assert.equal(filenameFromDisposition('attachment; filename="report.csv"'), "report.csv");
  assert.equal(
    filenameFromDisposition("attachment; filename*=UTF-8''site%20report.xlsx"),
    "site report.xlsx"
  );
  assert.equal(filenameFromDisposition('attachment; filename="../../bad.csv"'), ".._.._bad.csv");
});
