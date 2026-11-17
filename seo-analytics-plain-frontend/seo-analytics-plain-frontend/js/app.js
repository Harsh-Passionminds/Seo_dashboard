const API_BASE = (window.API_BASE || "http://localhost:5000/api").replace(/\/+$/, "");
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  user: null,
  organization: null,
  membership: null,
  permissions: null,
  websites: [],
  freshness: [],
  overview: null,
  comparisons: {},
  gsc: [],
  ga4: [],
  acquisition: [],
  keywords: [],
  keywordHistory: [],
  jobs: [],
  admin: {},
  currentView: "overview",
  activityPage: 1
};
const activeRequests = new Map();
const viewCopy = {
  overview: ["Overview", "Monitor organic visibility, traffic and conversions across authorized websites."],
  "search-console": ["Search Console", "Review daily Google Search Console performance."],
  analytics: ["Google Analytics", "Review organic sessions and conversion events from GA4."],
  acquisition: ["Acquisition reports", "Explore stored GA4 user and session acquisition data."],
  combined: ["Combined reports", "Compare persisted Google Search Console and GA4 metrics by date."],
  keywords: ["Keyword tracking", "Review Google Search Console history for manually tracked keywords."],
  websites: ["Websites", "View organization websites available to your account."],
  sync: ["Sync activity", "Track organization synchronization and imports."],
  admin: ["Administration", "Manage organization members, website access, integrations and settings."]
};

const api = window.ApiClient.createApiClient({
  baseUrl: API_BASE,
  onUnauthorized: () => showAuthGate("Your session expired. Sign in again to continue.")
});

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value, digits = 0) {
  const parsed = numberValue(value);
  return parsed === null ? "—" : parsed.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function pct(value) {
  const parsed = numberValue(value);
  return parsed === null ? "—" : `${(parsed * 100).toFixed(2)}%`;
}

function queryString(values) {
  return new URLSearchParams(Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]))
    .toString();
}

function reportRange() {
  return { startDate: $("#start-date").value, endDate: $("#end-date").value };
}

function siteId() {
  return $("#website-select").value;
}

function isAbort(error) {
  return error?.name === "AbortError";
}

function latestSignal(key) {
  activeRequests.get(key)?.abort();
  const controller = new AbortController();
  activeRequests.set(key, controller);
  return controller;
}

function requestIsCurrent(key, controller) {
  return !controller.signal.aborted && activeRequests.get(key) === controller;
}

function cancelRequest(key) {
  activeRequests.get(key)?.abort();
  activeRequests.delete(key);
}

function notice(message, type = "") {
  const element = $("#notice");
  element.textContent = message;
  element.className = `notice ${type}`.trim();
  element.classList.remove("hidden");
}

function hideNotice() {
  $("#notice").classList.add("hidden");
}

function handleError(error) {
  if (isAbort(error)) return;
  console.error("SEO Analytics request failed:", error);
  notice(error?.message || "Unexpected error. Please try again.", "error");
}

function setBusy(button, busy, busyText = "Working…") {
  if (!button) return () => {};
  const original = button.dataset.originalText || button.textContent;
  button.dataset.originalText = original;
  button.disabled = busy;
  button.textContent = busy ? busyText : original;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

function showAuthGate(message = "") {
  state.user = null;
  state.organization = null;
  state.membership = null;
  state.permissions = null;
  $("#workspace-content").classList.add("hidden");
  $("#auth-gate").classList.remove("hidden");
  $("#user-identity").classList.add("hidden");
  $("#logout-button").classList.add("hidden");
  $("#google-login").classList.remove("hidden");
  $("#google-login").textContent = "Sign in with Google";
  $("#employee-login-form").classList.remove("hidden");
  $("#password-change-form").classList.add("hidden");
  $("#auth-login").classList.remove("hidden");
  $("#auth-gate-message").textContent = message ||
    "Admins sign in with Google. Analysts and Viewers use the username and password provided by their Admin.";
  $("#admin-nav").classList.add("hidden");
  $$(".export-button").forEach((button) => button.classList.add("hidden"));
  $("#export-keyword-history").classList.add("hidden");
}

function showPasswordChangeGate() {
  state.user = null;
  state.organization = null;
  state.membership = null;
  state.permissions = null;
  $("#workspace-content").classList.add("hidden");
  $("#auth-gate").classList.remove("hidden");
  $("#user-identity").classList.add("hidden");
  $("#logout-button").classList.remove("hidden");
  $("#google-login").classList.add("hidden");
  $("#employee-login-form").classList.add("hidden");
  $("#password-change-form").classList.remove("hidden");
  $("#auth-login").classList.add("hidden");
  $("#auth-gate-message").textContent = "Your temporary password must be changed before you can access the workspace.";
}

function showWorkspace(session) {
  state.user = session.user;
  state.organization = session.organization;
  state.membership = session.membership;
  state.permissions = session.permissions;
  $("#auth-gate").classList.add("hidden");
  $("#workspace-content").classList.remove("hidden");
  $("#google-login").classList.add("hidden");
  $("#logout-button").classList.remove("hidden");
  $("#user-identity").classList.remove("hidden");
  $("#user-name").textContent = state.user.name || state.user.username || state.user.email;
  $("#user-context").textContent = `${state.organization.name} · ${state.membership.role}`;
  $("#admin-nav").classList.toggle("hidden", state.membership.role !== "admin");
  $("#sync-nav").classList.toggle("hidden", state.membership.role !== "admin");
  $("#open-add-website").classList.toggle("hidden", !state.permissions.canCreateWebsites);
  $("#quick-add-website")?.classList.toggle("hidden", !state.permissions.canCreateWebsites);
  $("#quick-sync")?.classList.toggle("hidden", !selectedSite()?.permissions?.canSync);
  $$(".export-button").forEach((button) =>
    button.classList.toggle("hidden", !state.permissions.canExportReports)
  );
  $("#export-keyword-history").classList.toggle("hidden", !state.permissions.canExportReports);
}

function setConnection(connected, label) {
  $(".connection-dot").classList.toggle("online", connected);
  $("#connection-label").textContent = label;
  $("#connection-sub").textContent = connected ? "API reachable" : "Check backend / database";
}

function normalizeWebsite(website) {
  return {
    id: Number(website.website_id ?? website.id),
    name: website.website_name ?? website.websiteName ?? website.name ?? "Website",
    domain: website.domain_name ?? website.domainName ?? website.domain_url ?? "",
    ga4: website.ga4_property_id ?? website.ga4PropertyId ?? "",
    gsc: website.gsc_property_url ?? website.gscPropertyUrl ?? "",
    activeJobs: Number(website.active_sync_jobs ?? 0),
    permissions: website.permissions || { canManage: false, canManageKeywords: false, canSync: false }
  };
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function setDefaultDates(days = 28) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  $("#end-date").value = dateString(end);
  $("#start-date").value = dateString(start);
}

function selectedSite() {
  return state.websites.find((website) => String(website.id) === siteId()) || null;
}

function renderWebsiteSelect() {
  const select = $("#website-select");
  const previous = select.value || sessionStorage.getItem("seo-selected-website") || "";
  select.innerHTML = '<option value="">Choose website…</option>' +
    state.websites.map((website) =>
      `<option value="${esc(website.id)}">${esc(website.name)} — ${esc(website.domain)}</option>`
    ).join("");
  select.value = state.websites.some((website) => String(website.id) === previous)
    ? previous
    : state.websites[0] ? String(state.websites[0].id) : "";
  if (select.value) sessionStorage.setItem("seo-selected-website", select.value);
  else sessionStorage.removeItem("seo-selected-website");
  $("#quick-sync")?.classList.toggle("hidden", !selectedSite()?.permissions?.canSync);
}

async function loadWebsites() {
  const controller = latestSignal("websites");
  try {
    const data = await api.request("/websites", { signal: controller.signal });
    if (!requestIsCurrent("websites", controller)) return;
    state.websites = (data.websites || []).map(normalizeWebsite);
    state.freshness = data.freshness || [];
    renderWebsiteSelect();
    renderWebsiteCards();
  } finally {
    if (activeRequests.get("websites") === controller) activeRequests.delete("websites");
  }
}

function renderWebsiteCards() {
  const container = $("#website-grid");
  if (!state.websites.length) {
    container.innerHTML = '<div class="panel empty-state"><span class="empty-icon">◎</span><strong>No websites available</strong><p>An organization Admin can grant website access, or you can add a website if your role permits.</p></div>';
    return;
  }
  container.innerHTML = state.websites.map((website) => `
    <article class="website-card">
      <div class="website-card-top"><div class="site-avatar">${esc(website.name[0]?.toUpperCase() || "W")}</div>
        <div style="min-width:0"><h3>${esc(website.name)}</h3><div class="domain">${esc(website.domain)}</div></div>
      </div>
      <div class="website-meta"><span>GA4 property <b>${esc(website.ga4 || "Not configured")}</b></span>
        <span>Search Console <b>${esc(website.gsc || "Not configured")}</b></span>
        <span>Active sync jobs <b>${fmt(website.activeJobs)}</b></span></div>
      <div class="card-actions"><button class="button button-outline" data-select-site="${esc(website.id)}">View reports</button>
        ${website.permissions.canSync ? `<button class="button button-primary" data-sync-site="${esc(website.id)}">Sync now</button>` : ""}
      </div>
    </article>`).join("");
  $$("[data-select-site]").forEach((button) => button.addEventListener("click", async () => {
    $("#website-select").value = button.dataset.selectSite;
    sessionStorage.setItem("seo-selected-website", button.dataset.selectSite);
    switchView("overview");
    await loadCurrentView();
  }));
  $$("[data-sync-site]").forEach((button) =>
    button.addEventListener("click", () => startSync(button.dataset.syncSite, button))
  );
}

function compareQuery(source, metrics, dimensions) {
  const current = reportRange();
  const query = {
    source,
    currentStartDate: current.startDate,
    currentEndDate: current.endDate,
    comparisonMode: $("#comparison-mode").value,
    metrics: metrics.join(","),
    dimensions: dimensions.join(","),
    groupBy: dimensions.join(",")
  };
  if (query.comparisonMode === "custom") {
    query.compareStartDate = $("#compare-start-date").value;
    query.compareEndDate = $("#compare-end-date").value;
  }
  return query;
}

async function loadComparison(source, metrics, dimensions, signal) {
  const query = compareQuery(source, metrics, dimensions);
  const response = await api.request(`/websites/${encodeURIComponent(siteId())}/reports/comparison`, {
    query,
    signal,
    timeoutMs: 45000
  });
  if (signal.aborted) throw new DOMException("Request was superseded.", "AbortError");
  state.comparisons[source] = response;
  return response;
}

function sumRows(rows, field) {
  if (!rows.length) return null;
  const found = rows.map((row) => numberValue(row[field])).filter((value) => value !== null);
  return found.length ? found.reduce((sum, value) => sum + value, 0) : null;
}

function gscTotals(rows) {
  const clicks = sumRows(rows, "clicks");
  const impressions = sumRows(rows, "impressions");
  const weighted = rows.reduce((result, row) => {
    const position = numberValue(row.average_position);
    const weight = numberValue(row.impressions);
    if (position === null || weight === null) return result;
    result.value += position * weight;
    result.weight += weight;
    return result;
  }, { value: 0, weight: 0 });
  return {
    clicks,
    impressions,
    ctr: impressions > 0 && clicks !== null ? clicks / impressions : null,
    average_position: weighted.weight > 0 ? weighted.value / weighted.weight : null
  };
}

function ga4Totals(rows) {
  const conversions = rows.map((row) => {
    const total = numberValue(row.total_form_conversions);
    if (total !== null) return total;
    const first = numberValue(row.form_submit_conversions);
    const second = numberValue(row.from_submit_conversions);
    return first === null && second === null ? null : (first || 0) + (second || 0);
  });
  const usable = conversions.filter((value) => value !== null);
  return {
    organic_sessions: sumRows(rows, "organic_sessions"),
    total_form_conversions: usable.length ? usable.reduce((sum, value) => sum + value, 0) : null
  };
}

function changeText(summary, metric) {
  if (!summary || summary.currentValue === null || summary.previousValue === null) {
    return "Comparison data unavailable";
  }
  const absolute = numberValue(summary.absoluteChange);
  const change = absolute === null ? "—" : `${absolute > 0 ? "+" : ""}${fmt(absolute, metric === "average_position" ? 2 : 0)}`;
  const percent = summary.percentageChange === null || summary.percentageChange === undefined
    ? "percentage unavailable"
    : `${summary.percentageChange > 0 ? "+" : ""}${fmt(summary.percentageChange, 1)}%`;
  const trend = metric === "average_position"
    ? summary.performanceTrend
    : summary.trend;
  const current = fmt(summary.currentValue, metric === "average_position" ? 2 : 0);
  const previous = fmt(summary.previousValue, metric === "average_position" ? 2 : 0);
  return `Current ${current} · Comparison ${previous} · Change ${change} (${percent}) · ${trend || "unavailable"}`;
}

function setMetric(valueId, captionId, value, comparison, metric) {
  $(valueId).textContent = fmt(value, metric === "average_position" ? 2 : 0);
  const label = $(captionId);
  if (comparison) {
    label.textContent = changeText(comparison, metric);
    const reportSource = metric === "organic_sessions" || metric === "total_form_conversions" ? "ga4" : "gsc";
    const periods = state.comparisons[reportSource]?.periods;
    label.title = periods
      ? `${periods.current.startDate} to ${periods.current.endDate} compared with ${periods.comparison.startDate} to ${periods.comparison.endDate}`
      : "Comparison unavailable";
    label.className = "comparison-text";
  } else {
    label.textContent = metric === "clicks" ? "Google Search Console"
      : metric === "impressions" ? "Search visibility"
        : metric === "organic_sessions" ? "Google Analytics 4"
          : "GA4 event count";
    label.className = "metric-caption";
  }
}

function renderOverview() {
  const gsc = gscTotals(state.gsc);
  const ga4 = ga4Totals(state.ga4);
  const compare = $("#compare-period").checked;
  const gscSummary = state.comparisons.gsc?.summary || {};
  const ga4Summary = state.comparisons.ga4?.summary || {};
  setMetric("#metric-clicks", "#compare-clicks", gsc.clicks, compare ? gscSummary.clicks : null, "clicks");
  setMetric("#metric-impressions", "#compare-impressions", gsc.impressions, compare ? gscSummary.impressions : null, "impressions");
  setMetric("#metric-sessions", "#compare-sessions", ga4.organic_sessions, compare ? ga4Summary.organic_sessions : null, "organic_sessions");
  setMetric("#metric-conversions", "#compare-conversions", ga4.total_form_conversions, compare ? ga4Summary.total_form_conversions : null, "total_form_conversions");
  const current = reportRange();
  const comparison = state.comparisons.gsc?.periods?.comparison;
  $("#summary-range-label").textContent = comparison
    ? `${current.startDate} to ${current.endDate} compared with ${comparison.startDate} to ${comparison.endDate}`
    : `${current.startDate} to ${current.endDate}`;
  renderOverviewChart();
  renderSyncFreshness();
}

function renderOverviewChart() {
  const rows = state.gsc;
  if (!rows.length && !state.ga4.length) {
    $("#overview-summary").innerHTML = '<div class="empty-state"><strong>No stored report data</strong><p>There are no rows for this website and date range. Sync activity is shown below when available.</p></div>';
    return;
  }
  const dates = [...new Set([...state.gsc, ...state.ga4].map((row) =>
    String(row.report_date || "").slice(0, 10)
  ).filter(Boolean))].sort();
  const width = 760;
  const height = 220;
  const left = 44;
  const right = 18;
  const top = 20;
  const bottom = 38;
  const series = [
    { name: "Clicks", color: "#6257e8", rows: state.gsc, field: "clicks" },
    { name: "Organic sessions", color: "#25b77f", rows: state.ga4, field: "organic_sessions" }
  ];
  const values = series.flatMap(({ rows: data, field }) => data.map((row) => numberValue(row[field])))
    .filter((value) => value !== null);
  const max = Math.max(1, ...values);
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const x = (date) => dates.length < 2 ? left + plotWidth / 2
    : left + (dateIndex.get(date) / (dates.length - 1)) * plotWidth;
  const y = (value) => top + plotHeight - (value / max) * plotHeight;
  const paths = series.map(({ name, color, rows: data, field }) => {
    const points = data.map((row) => ({
      date: String(row.report_date || "").slice(0, 10),
      value: numberValue(row[field])
    })).filter((point) => point.value !== null && dateIndex.has(point.date));
    if (!points.length) return "";
    return `<polyline points="${points.map((point) => `${x(point.date)},${y(point.value)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="3"><title>${esc(name)}</title></polyline>`;
  }).join("");
  $("#overview-summary").innerHTML = `<div class="chart-content"><div class="chart-legend"><span><i class="legend-clicks"></i>Clicks</span><span><i class="legend-sessions"></i>Organic sessions</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Stored daily Search Console clicks and organic sessions">${paths}<text x="${left}" y="${height - 8}" class="chart-axis">${esc(dates[0] || "")}</text><text x="${width - right}" y="${height - 8}" text-anchor="end" class="chart-axis">${esc(dates[dates.length - 1] || "")}</text></svg><p class="form-help">Only dates returned by the backend are plotted; missing dates are not filled with zero.</p></div>`;
}

function renderSyncFreshness() {
  const sync = state.overview?.sync;
  if (!sync) return;
  const checkpoints = sync.checkpoints || [];
  const label = checkpoints.length
    ? checkpoints.map((item) => `${item.source} ${item.report_type}: ${item.status}, through ${item.last_successful_date || "no successful date"}`).join(" · ")
    : "No synchronization checkpoints have been recorded.";
  const previous = $("#sync-freshness");
  if (previous) previous.textContent = label;
  else $("#overview-summary").insertAdjacentHTML("beforeend", `<p class="form-help" id="sync-freshness">${esc(label)}</p>`);
}

function renderGsc() {
  const rows = state.gsc;
  $("#gsc-table").innerHTML = rows.length ? rows.map((row) => `
    <tr><td>${esc(String(row.report_date || "").slice(0, 10))}</td><td>${fmt(row.clicks)}</td>
    <td>${fmt(row.impressions)}</td><td>${pct(row.ctr)}</td><td>${fmt(row.average_position, 2)}</td></tr>`
  ).join("") : '<tr><td colspan="5" class="empty-cell">No Search Console rows for the selected website and date range.</td></tr>';
}

function renderGa4() {
  const rows = state.ga4;
  $("#ga4-table").innerHTML = rows.length ? rows.map((row) => `
    <tr><td>${esc(String(row.report_date || "").slice(0, 10))}</td><td>${fmt(row.organic_sessions)}</td>
    <td>${fmt(row.form_submit_conversions)}</td><td>${fmt(row.from_submit_conversions)}</td>
    <td>${fmt(row.total_form_conversions)}</td></tr>`
  ).join("") : '<tr><td colspan="5" class="empty-cell">No GA4 summary rows for the selected website and date range.</td></tr>';
}

async function refreshReports() {
  const id = siteId();
  if (!id) {
    state.overview = null;
    state.gsc = [];
    state.ga4 = [];
    state.comparisons = {};
    renderOverview();
    renderGsc();
    renderGa4();
    return;
  }
  const dates = reportRange();
  if (!dates.startDate || !dates.endDate || dates.startDate > dates.endDate) {
    notice("Choose a valid start and end date.", "error");
    return;
  }
  const controller = latestSignal("reports");
  state.comparisons = {};
  $("#overview-summary").innerHTML = '<div class="empty-state"><strong>Loading stored report data…</strong></div>';
  try {
    const overviewQuery = queryString(dates);
    const tasks = [
      api.request(`/websites/${encodeURIComponent(id)}/overview?${overviewQuery}`, {
        signal: controller.signal,
        timeoutMs: 45000
      })
    ];
    if ($("#compare-period").checked && state.currentView !== "combined") {
      tasks.push(
        loadComparison("gsc", ["clicks", "impressions", "ctr", "average_position"], ["date"], controller.signal),
        loadComparison("ga4", ["organic_sessions", "form_submit_conversions", "from_submit_conversions", "total_form_conversions"], ["date"], controller.signal)
      );
    }
    const results = await Promise.allSettled(tasks);
    if (!requestIsCurrent("reports", controller)) return;
    const overviewResult = results[0];
    if (overviewResult.status === "rejected") throw overviewResult.reason;
    state.overview = overviewResult.value;
    state.gsc = state.overview.data?.googleSearchConsole || [];
    state.ga4 = state.overview.data?.googleAnalytics || [];
    renderOverview();
    renderGsc();
    renderGa4();
    const failures = results.slice(1).filter((result) => result.status === "rejected");
    if (failures.length) {
      notice(`Current report data loaded, but comparison failed: ${failures.map((result) => result.reason.message).join(" · ")}`, "error");
    } else {
      hideNotice();
    }
  } finally {
    if (activeRequests.get("reports") === controller) activeRequests.delete("reports");
  }
}

async function loadCombinedReport() {
  if (!siteId()) {
    $("#combined-table").innerHTML = '<tr><td colspan="7" class="empty-cell">Select a website to view combined report data.</td></tr>';
    return;
  }
  const controller = latestSignal("combined");
  const current = reportRange();
  const query = {
    source: "combined",
    currentStartDate: current.startDate,
    currentEndDate: current.endDate,
    comparisonMode: $("#compare-period").checked ? $("#comparison-mode").value : "previous_period",
    metrics: "clicks,impressions,ctr,average_position,organic_sessions,form_submit_conversions,from_submit_conversions,total_form_conversions",
    dimensions: "date",
    groupBy: "date"
  };
  if ($("#compare-period").checked && query.comparisonMode === "custom") {
    query.compareStartDate = $("#compare-start-date").value;
    query.compareEndDate = $("#compare-end-date").value;
  }
  try {
    const result = await api.request(`/websites/${encodeURIComponent(siteId())}/reports/comparison`, {
      query,
      signal: controller.signal,
      timeoutMs: 45000
    });
    if (!requestIsCurrent("combined", controller)) return;
    const rows = [
      ...(result.data?.current || []).map((row) => ({ ...row, period: "Current" })),
      ...($("#compare-period").checked
        ? (result.data?.comparison || []).map((row) => ({ ...row, period: "Comparison" }))
        : [])
    ];
    const currentPeriod = result.periods?.current;
    const previousPeriod = result.periods?.comparison;
    $("#view-combined .panel-heading p").textContent = $("#compare-period").checked
      ? `Current ${currentPeriod.startDate} to ${currentPeriod.endDate} · Comparison ${previousPeriod.startDate} to ${previousPeriod.endDate}`
      : `${currentPeriod.startDate} to ${currentPeriod.endDate}`;
    $("#view-combined thead").innerHTML = `<tr>${$("#compare-period").checked ? "<th>Period</th>" : ""}
      <th>Date</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Average position</th>
      <th>Organic sessions</th><th>Form conversions</th></tr>`;
    $("#combined-table").innerHTML = rows.length ? rows.map((row) => `
      <tr>${$("#compare-period").checked ? `<td>${esc(row.period)}</td>` : ""}
      <td>${esc(row.date || "—")}</td><td>${fmt(row.clicks)}</td><td>${fmt(row.impressions)}</td>
      <td>${pct(row.ctr)}</td><td>${fmt(row.average_position, 2)}</td><td>${fmt(row.organic_sessions)}</td>
      <td>${fmt(row.total_form_conversions)}</td></tr>`).join("")
      : '<tr><td colspan="8" class="empty-cell">No combined rows are stored for the selected period.</td></tr>';
  } finally {
    if (activeRequests.get("combined") === controller) activeRequests.delete("combined");
  }
}

function parseObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
}

function acquisitionMetrics(row) {
  return parseObject(row.metrics_json ?? row.metrics);
}

function renderAcquisition() {
  const type = $("#acquisition-type").value;
  const dimension = $("#acquisition-dimension").value;
  const search = $("#acquisition-search").value.trim().toLowerCase();
  const select = $("#acquisition-channel");
  const metrics = type === "traffic_acquisition"
    ? [["Sessions", "sessions"], ["Engaged sessions", "engagedSessions"], ["Engagement rate", "engagementRate"]]
    : [["Daily total users", "totalUsers"], ["Daily new users", "newUsers"], ["Daily active users", "activeUsers"],
      ["Engaged sessions", "engagedSessions"], ["Engagement rate", "engagementRate"],
      ["Average session duration (seconds)", "averageSessionDuration"], ["Conversions", "conversions"], ["Revenue", "totalRevenue"]];
  const rows = state.acquisition.map((row) => {
    const values = acquisitionMetrics(row);
    const label = row.dimensionValue ?? row.dimension_value ??
      row.dimensions?.[dimension === "source_medium" ? "firstUserSourceMedium" : "firstUserDefaultChannelGroup"] ??
      row.dimensions?.[dimension === "source_medium" ? "sessionSourceMedium" : "sessionDefaultChannelGroup"] ??
      "Unspecified";
    const valuesForRow = {
      ...values,
      sessions: row.sessions ?? values.sessions,
      engagedSessions: row.engagedSessions ?? row.engaged_sessions ?? values.engagedSessions,
      engagementRate: row.sessions > 0
        ? Number(row.engagedSessions ?? row.engaged_sessions) / Number(row.sessions)
        : values.engagementRate
    };
    return { row, values: valuesForRow, label: String(label) };
  });
  const labels = [...new Set(rows.map((item) => item.label))].sort((a, b) => a.localeCompare(b));
  const old = select.value;
  select.innerHTML = '<option value="">All dimensions</option>' + labels.map((label) =>
    `<option value="${esc(label)}">${esc(label)}</option>`
  ).join("");
  if (labels.includes(old)) select.value = old;
  const selected = select.value;
  const filtered = rows.filter((item) =>
    (!selected || item.label === selected) &&
    (!search || JSON.stringify(item.row).toLowerCase().includes(search))
  );
  $("#acquisition-channel-label").textContent = `Filter by ${dimension === "source_medium" ? "Source / medium" : "Default channel group"}`;
  const headers = type === "user_acquisition" ? ["Date", "Dimension", ...metrics.map(([label]) => label)] : ["Dimension", ...metrics.map(([label]) => label)];
  $("#acquisition-thead").innerHTML = `<tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr>`;
  $("#acquisition-table").innerHTML = filtered.length ? filtered.map(({ row, values, label }) => `
    <tr>${type === "user_acquisition" ? `<td>${esc(String(row.date || row.report_date || "").slice(0, 10))}</td>` : ""}
    <td>${esc(label)}</td>${metrics.map(([metricLabel, key]) => {
      const value = numberValue(values[key]);
      return `<td>${value === null ? "—" : /rate/i.test(metricLabel) ? pct(value) : fmt(value, key === "averageSessionDuration" ? 2 : 0)}</td>`;
    }).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty-cell">${state.acquisition.length ? "No rows match the selected filters." : "No stored acquisition rows for this website and date range."}</td></tr>`;
  const comparison = state.comparisons[type]?.summary;
  const comparisonText = comparison
    ? Object.entries(comparison).map(([key, value]) => `${key}: ${changeText(value, key)}`).join(" · ")
    : "";
  $("#acquisition-count").textContent = `${filtered.length} of ${rows.length} stored rows${comparisonText ? ` · ${comparisonText}` : ""}`;
}

async function loadAcquisition() {
  if (!siteId()) {
    state.acquisition = [];
    $("#acquisition-thead").innerHTML = "";
    $("#acquisition-table").innerHTML = '<tr><td class="empty-cell">Select a website to view acquisition data.</td></tr>';
    $("#acquisition-count").textContent = "";
    return;
  }
  const controller = latestSignal("acquisition");
  const type = $("#acquisition-type").value;
  const query = {
    ...reportRange(),
    reportType: type,
    dimensionType: $("#acquisition-dimension").value
  };
  try {
    const tasks = [api.request(`/websites/${encodeURIComponent(siteId())}/ga4`, {
      query,
      signal: controller.signal,
      timeoutMs: 45000
    })];
    if ($("#compare-period").checked) {
      const metrics = type === "traffic_acquisition"
        ? ["sessions", "engagedSessions", "engagementRate"]
        : ["totalUsers", "newUsers", "activeUsers", "engagedSessions", "engagementRate", "averageSessionDuration", "conversions", "totalRevenue"];
      const dimensions = type === "traffic_acquisition" ? ["dimensionValue", "dimensionType"] : ["date", "dimensionValue"];
      tasks.push(loadComparison(type, metrics, dimensions, controller.signal));
    } else {
      delete state.comparisons[type];
    }
    const [report] = await Promise.all(tasks);
    if (!requestIsCurrent("acquisition", controller)) return;
    state.acquisition = report.rows || [];
    renderAcquisition();
  } finally {
    if (activeRequests.get("acquisition") === controller) activeRequests.delete("acquisition");
  }
}

function canManageSelectedKeywords() {
  return Boolean(selectedSite()?.permissions?.canManageKeywords);
}

async function loadKeywords() {
  if (!siteId()) {
    state.keywords = [];
    state.keywordHistory = [];
    renderKeywords();
    renderKeywordHistory();
    return;
  }
  const controller = latestSignal("keywords");
  $("#keywords-table").innerHTML = '<tr><td colspan="3" class="empty-cell">Loading keywords…</td></tr>';
  try {
    const data = await api.request(`/websites/${encodeURIComponent(siteId())}/gsc/keywords`, {
      signal: controller.signal
    });
    if (!requestIsCurrent("keywords", controller)) return;
    state.keywords = data.keywords || [];
    const activeKeyword = $("#keyword-select").value;
    renderKeywords();
    if (state.keywords.some((keyword) => String(keyword.keyword_id) === activeKeyword)) {
      $("#keyword-select").value = activeKeyword;
      await loadKeywordHistory();
    } else {
      $("#keyword-select").value = "";
      state.keywordHistory = [];
      renderKeywordHistory();
    }
  } finally {
    if (activeRequests.get("keywords") === controller) activeRequests.delete("keywords");
  }
}

function renderKeywords() {
  const canManage = canManageSelectedKeywords();
  $("#keyword-form").classList.toggle("hidden", !canManage);
  $("#sync-keyword-history").classList.toggle("hidden", !canManage);
  $("#keywords-table").innerHTML = state.keywords.length ? state.keywords.map((keyword) => `
    <tr><td>${esc(keyword.keyword)}</td>
    <td>${esc(String(keyword.created_at || "").replace("T", " ").slice(0, 19))}</td>
    <td>${canManage ? `<button class="button button-outline keyword-delete" type="button" data-keyword-id="${esc(keyword.keyword_id)}">Delete</button>` : "Read only"}</td></tr>`
  ).join("") : '<tr><td colspan="3" class="empty-cell">No keywords tracked for this website.</td></tr>';
  $("#keyword-select").innerHTML = '<option value="">Select keyword…</option>' +
    state.keywords.map((keyword) => `<option value="${esc(keyword.keyword_id)}">${esc(keyword.keyword)}</option>`).join("");
  $$(".keyword-delete").forEach((button) => button.addEventListener("click", () => deleteKeyword(button.dataset.keywordId)));
}

async function addKeyword(event) {
  event.preventDefault();
  if (!siteId() || !canManageSelectedKeywords()) return notice("You need website-owner access to add keywords.", "error");
  const keyword = $("#keyword-input").value.trim();
  if (!keyword) return notice("Enter a keyword.", "error");
  const button = $("#keyword-form button[type=submit]");
  const done = setBusy(button, true, "Adding…");
  try {
    const result = await api.request(`/websites/${encodeURIComponent(siteId())}/gsc/keywords`, {
      method: "POST",
      body: JSON.stringify({ keyword })
    });
    $("#keyword-input").value = "";
    await loadKeywords();
    if (result.keyword?.keyword_id) {
      $("#keyword-select").value = String(result.keyword.keyword_id);
      await loadKeywordHistory();
    }
    notice("Keyword added. Use Sync history to fetch Google Search Console rows.", "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function deleteKeyword(keywordId) {
  if (!confirm("Delete this tracked keyword and its stored history?")) return;
  try {
    await api.request(`/websites/${encodeURIComponent(siteId())}/gsc/keywords/${encodeURIComponent(keywordId)}`, {
      method: "DELETE"
    });
    if ($("#keyword-select").value === String(keywordId)) $("#keyword-select").value = "";
    await loadKeywords();
    notice("Keyword and its stored history were deleted.", "success");
  } catch (error) {
    handleError(error);
  }
}

async function loadKeywordHistory() {
  const keywordId = $("#keyword-select").value;
  if (!siteId() || !keywordId) {
    state.keywordHistory = [];
    renderKeywordHistory();
    return;
  }
  const controller = latestSignal("keyword-history");
  const query = queryString(reportRange());
  $("#keyword-history-table").innerHTML = '<tr><td colspan="5" class="empty-cell">Loading keyword history…</td></tr>';
  try {
    const data = await api.request(`/websites/${encodeURIComponent(siteId())}/gsc/keywords/${encodeURIComponent(keywordId)}/history?${query}`, {
      signal: controller.signal
    });
    if (!requestIsCurrent("keyword-history", controller)) return;
    state.keywordHistory = data.rows || [];
    renderKeywordHistory();
  } finally {
    if (activeRequests.get("keyword-history") === controller) activeRequests.delete("keyword-history");
  }
}

async function syncKeywordHistory(button = $("#sync-keyword-history")) {
  const keywordId = $("#keyword-select").value;
  if (!siteId() || !keywordId) return notice("Select a website and keyword first.", "error");
  if (!canManageSelectedKeywords()) return notice("Only the website owner can sync keyword history.", "error");
  const done = setBusy(button, true, "Syncing…");
  try {
    const response = await api.request(`/websites/${encodeURIComponent(siteId())}/gsc/keywords/${encodeURIComponent(keywordId)}/history/sync`, {
      method: "POST",
      body: JSON.stringify(reportRange()),
      timeoutMs: 60000
    });
    await loadKeywordHistory();
    notice(response.message || "Keyword history was synchronized.", "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

function renderKeywordHistory() {
  const rows = state.keywordHistory || [];
  $("#keyword-history-table").innerHTML = rows.length ? rows.map((row) => `
    <tr><td>${esc(String(row.report_date || "").slice(0, 10))}</td><td>${fmt(row.clicks)}</td>
    <td>${fmt(row.impressions)}</td><td>${pct(row.ctr)}</td><td>${fmt(row.average_position, 2)}</td></tr>`
  ).join("") : '<tr><td colspan="5" class="empty-cell">No stored keyword history for this date range.</td></tr>';
  if (!rows.length) {
    $("#keyword-chart").innerHTML = '<div class="empty-state"><strong>No keyword history in this date range</strong></div>';
    $("#keyword-summary").innerHTML = ["Clicks", "Impressions", "CTR", "Latest position"].map((label) =>
      `<article class="metric-card"><div class="metric-top"><span>${label}</span></div><strong>—</strong></article>`
    ).join("");
    return;
  }
  const clicks = sumRows(rows, "clicks");
  const impressions = sumRows(rows, "impressions");
  const ctr = impressions > 0 ? clicks / impressions : null;
  const last = rows[rows.length - 1];
  $("#keyword-summary").innerHTML = [
    ["Clicks", fmt(clicks)], ["Impressions", fmt(impressions)], ["CTR", pct(ctr)],
    ["Latest position", fmt(last.average_position, 2)]
  ].map(([label, value]) => `<article class="metric-card"><div class="metric-top"><span>${label}</span></div><strong>${value}</strong></article>`).join("");

  const plotted = rows.map((row) => ({
    date: String(row.report_date || "").slice(0, 10),
    position: numberValue(row.average_position)
  })).filter((row) => row.position !== null);
  if (!plotted.length) {
    $("#keyword-chart").innerHTML = '<div class="empty-state"><strong>Position data is unavailable for these rows.</strong></div>';
    return;
  }
  const width = 760;
  const height = 260;
  const left = 52;
  const right = 18;
  const top = 18;
  const bottom = 38;
  const minPosition = Math.min(...plotted.map((row) => row.position), 1);
  const maxPosition = Math.max(...plotted.map((row) => row.position), 1);
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const y = (position) => top + ((position - minPosition) / Math.max(1, maxPosition - minPosition)) * plotHeight;
  const x = (index) => plotted.length === 1 ? left + plotWidth / 2 : left + index / (plotted.length - 1) * plotWidth;
  const points = plotted.map((row, index) => `${x(index)},${y(row.position)}`).join(" ");
  $("#keyword-chart").innerHTML = `<svg class="position-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Google Search Console average position history">
    <polyline points="${points}" class="position-line"/>
    ${plotted.map((row, index) => `<circle cx="${x(index)}" cy="${y(row.position)}" r="3" class="position-dot"><title>${esc(row.date)}: ${fmt(row.position, 2)}</title></circle>`).join("")}
    <text x="${left}" y="${height - 8}" class="chart-axis">${esc(plotted[0].date)}</text>
    <text x="${width - right}" y="${height - 8}" text-anchor="end" class="chart-axis">${esc(plotted[plotted.length - 1].date)}</text>
    <text x="14" y="${top + plotHeight / 2}" text-anchor="middle" class="chart-axis" transform="rotate(-90 14 ${top + plotHeight / 2})">Average position (lower is better)</text>
  </svg>`;
}

function exportOptions(type) {
  const current = reportRange();
  const options = {
    startDate: current.startDate,
    endDate: current.endDate,
    format: $(`[data-export="${type}"]`)?.closest(".inline-actions")?.querySelector(".export-format")?.value || "csv",
    sortBy: "date",
    order: "asc"
  };
  if (type === "gsc") {
    Object.assign(options, { source: "gsc", metrics: "clicks,impressions,ctr,average_position", dimensions: "date" });
  } else if (type === "ga4") {
    Object.assign(options, { source: "ga4", metrics: "organic_sessions,form_submit_conversions,from_submit_conversions,total_form_conversions", dimensions: "date" });
  } else if (type === "combined") {
    Object.assign(options, {
      source: "combined",
      metrics: "clicks,impressions,ctr,average_position,organic_sessions,form_submit_conversions,from_submit_conversions,total_form_conversions",
      dimensions: "date"
    });
  } else {
    const reportType = $("#acquisition-type").value;
    const dimensionType = $("#acquisition-dimension").value;
    options.source = reportType;
    options.metrics = reportType === "traffic_acquisition"
      ? "sessions,engagedSessions,engagementRate"
      : "totalUsers,newUsers,activeUsers,engagedSessions,engagementRate,averageSessionDuration,conversions,totalRevenue";
    options.dimensions = reportType === "traffic_acquisition" ? "dimensionValue,dimensionType" : "date,dimensionValue";
    options.sortBy = reportType === "traffic_acquisition" ? "dimensionValue" : "date";
    options.order = reportType === "traffic_acquisition" ? "desc" : "asc";
    const dimensionValue = $("#acquisition-channel").value;
    if (dimensionValue) options.filters = { dimensionType, dimensionValue };
  }
  return options;
}

async function exportReport(type, button) {
  if (!state.permissions?.canExportReports) return notice("Your organization does not allow report exports for your role.", "error");
  if (!siteId()) return notice("Select a website before exporting.", "error");
  const options = type === "keyword_tracking"
    ? {
        source: "keyword_tracking",
        startDate: reportRange().startDate,
        endDate: reportRange().endDate,
        format: $("#keyword-export-format").value,
        metrics: "clicks,impressions,ctr,average_position",
        dimensions: "date,keyword",
        filters: { keywordId: Number($("#keyword-select").value) },
        sortBy: "date",
        order: "asc"
      }
    : exportOptions(type);
  if (type === "keyword_tracking" && !options.filters.keywordId) return notice("Select a keyword before exporting its history.", "error");
  const done = setBusy(button, true, "Exporting…");
  try {
    const query = queryString(options);
    await api.download(`/websites/${encodeURIComponent(siteId())}/reports/export?${query}`, {
      timeoutMs: 120000
    });
    notice(`${options.format.toUpperCase()} export downloaded.`, "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function loadJobs() {
  const controller = latestSignal("jobs");
  $("#jobs-table").innerHTML = '<tr><td colspan="6" class="empty-cell">Loading synchronization jobs…</td></tr>';
  try {
    const data = await api.request("/sync-jobs", { signal: controller.signal });
    if (!requestIsCurrent("jobs", controller)) return;
    state.jobs = data.jobs || [];
    $("#jobs-table").innerHTML = state.jobs.length ? state.jobs.map((job) => {
      const status = String(job.status || "unknown").toLowerCase();
      const className = status === "failed" ? "failed" : status === "completed" ? "completed" : "pending";
      const type = [job.sync_type, job.source, job.report_type].filter(Boolean).join(" / ");
      return `<tr><td>${esc(job.job_id)}</td><td>${esc(job.website_name || job.website_id)}</td>
        <td>${esc(type || "—")}</td><td><span class="status-chip ${className}">${esc(status)}</span></td>
        <td>${fmt(job.rows_fetched)}</td><td>${esc(job.created_at || "—")}</td></tr>`;
    }).join("") : '<tr><td colspan="6" class="empty-cell">No synchronization jobs found.</td></tr>';
  } finally {
    if (activeRequests.get("jobs") === controller) activeRequests.delete("jobs");
  }
}

async function startSync(id = siteId(), button = null) {
  const website = state.websites.find((item) => String(item.id) === String(id));
  if (!website?.permissions?.canSync) return notice("Only a website owner can start synchronization.", "error");
  const done = setBusy(button, true, "Queueing…");
  try {
    const result = await api.request(`/websites/${encodeURIComponent(id)}/sync`, {
      method: "POST",
      body: JSON.stringify({})
    });
    notice(result.message || "Synchronization jobs were queued.", "success");
    switchView("sync");
    await loadJobs();
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

function openDialog() {
  const dialog = $("#website-dialog");
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog() {
  const dialog = $("#website-dialog");
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

async function createWebsite(event) {
  event.preventDefault();
  if (!state.permissions?.canCreateWebsites) return notice("Your role cannot create websites.", "error");
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('[type="submit"]');
  const done = setBusy(button, true, "Saving…");
  const payload = {
    websiteName: values.websiteName.trim(),
    domainName: values.domainName.trim(),
    ga4PropertyId: values.ga4PropertyId.trim(),
    timezone: state.organization.defaultTimezone || "UTC"
  };
  if (values.gscPropertyUrl.trim()) payload.gscPropertyUrl = values.gscPropertyUrl.trim();
  try {
    const result = await api.request("/websites", { method: "POST", body: JSON.stringify(payload) });
    closeDialog();
    form.reset();
    await loadWebsites();
    if (result.website?.website_id) {
      $("#website-select").value = String(result.website.website_id);
      sessionStorage.setItem("seo-selected-website", String(result.website.website_id));
    }
    renderWebsiteCards();
    switchView("overview");
    await refreshReports();
    notice(result.message || "Website saved. Historical synchronization was queued.", "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

function adminData(response) {
  return response?.data;
}

function adminQuery(path, values, signal) {
  return api.request(`${path}?${queryString(values)}`, { signal });
}

function renderAdminOverview(overview) {
  const cards = [
    ["Active members", overview.members?.active],
    ["Total websites", overview.totalWebsites],
    ["Pending invitations", overview.pendingInvitations],
    ["Connected Google integrations", overview.connectedGoogleIntegrations]
  ];
  $("#admin-overview").innerHTML = cards.map(([label, value]) =>
    `<article class="metric-card"><div class="metric-top"><span>${esc(label)}</span></div><strong>${fmt(value)}</strong></article>`
  ).join("");
}

function renderAdminWebsites(websites) {
  $("#admin-websites-table").innerHTML = websites.length ? websites.map((website) => `
    <tr><td>${esc(website.website_name)}</td><td>${esc(website.domain_name)}</td>
    <td>${esc(website.owner_email || "—")}</td><td>${website.is_active ? "Active" : "Inactive"}</td>
    <td>${fmt(website.active_sync_jobs)}</td></tr>`
  ).join("") : '<tr><td colspan="5" class="empty-cell">No organization websites found.</td></tr>';
}

function renderMemberTable(members) {
  $("#members-table").innerHTML = members.length ? members.map((member) => {
    const userId = member.id ?? member.userId ?? member.user_id;
    const name = member.name ?? member.displayName ?? member.display_name ?? "—";
    const userLabel = member.username || member.email || "Google Admin";
    const roles = member.isEmployeeAccount ? ["analyst", "viewer"] : ["admin"];
    return `<tr><td>${esc(name)}</td><td>${esc(userLabel)}</td>
      <td><select class="member-role" data-user-id="${esc(userId)}" aria-label="Role for ${esc(userLabel)}">
        ${roles.map((role) => `<option value="${role}" ${role === member.role ? "selected" : ""}>${role}</option>`).join("")}
      </select></td><td><span class="status-chip ${esc(member.status)}">${esc(member.status)}</span></td>
      <td>${esc((member.assignedWebsiteIds || member.websiteIds || []).join(", ") || "None")}</td>
      <td>${esc(member.lastLoginAt || "—")}</td>
      <td class="admin-action-group"><button class="button button-outline" data-role-save="${esc(userId)}">Save role</button>
        ${member.status === "revoked" ? "" : `<button class="button button-outline" data-status-toggle="${esc(userId)}" data-status="${esc(member.status)}">${member.status === "active" ? "Deactivate" : "Activate"}</button>`}
        <button class="button button-outline" data-access-edit="${esc(userId)}">Websites</button>
        ${member.isEmployeeAccount ? `<button class="button button-outline" data-password-reset="${esc(userId)}">Reset password</button>` : ""}
        <button class="button button-outline" data-member-revoke="${esc(userId)}">Revoke</button></td></tr>`;
  }).join("") : '<tr><td colspan="7" class="empty-cell">No organization members found.</td></tr>';
  $$(".member-role").forEach((select) => select.addEventListener("change", () => {
    const save = $(`[data-role-save="${select.dataset.userId}"]`);
    save.dataset.changed = "true";
  }));
  $$("[data-role-save]").forEach((button) => button.addEventListener("click", () => saveMemberRole(button)));
  $$("[data-status-toggle]").forEach((button) => button.addEventListener("click", () => changeMemberStatus(button)));
  $$("[data-access-edit]").forEach((button) => button.addEventListener("click", () => {
    $("#access-member").value = button.dataset.accessEdit;
    loadWebsiteAccess(button.dataset.accessEdit).catch(handleError);
  }));
  $$("[data-member-revoke]").forEach((button) => button.addEventListener("click", () => revokeMember(button)));
  $$("[data-password-reset]").forEach((button) => button.addEventListener("click", () => resetEmployeePassword(button)));
}

async function saveMemberRole(button) {
  const userId = button.dataset.roleSave;
  const role = $(`.member-role[data-user-id="${userId}"]`).value;
  const done = setBusy(button, true, "Saving…");
  try {
    await api.request(`/admin/users/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role })
    });
    await loadAdmin();
    notice("Employee role updated.", "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function changeMemberStatus(button) {
  const userId = button.dataset.statusToggle;
  const status = button.dataset.status === "active" ? "inactive" : "active";
  if (!confirm(`${status === "inactive" ? "Deactivate" : "Activate"} this employee?`)) return;
  const done = setBusy(button, true, "Saving…");
  try {
    await api.request(`/admin/users/${encodeURIComponent(userId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadAdmin();
    notice(`Employee ${status === "active" ? "activated" : "deactivated"}.`, "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function revokeMember(button) {
  if (!confirm("Revoke this employee's organization access? Existing sessions will be invalidated.")) return;
  const done = setBusy(button, true, "Revoking…");
  try {
    await api.request(`/admin/users/${encodeURIComponent(button.dataset.memberRevoke)}`, { method: "DELETE" });
    await loadAdmin();
    notice("Employee access revoked.", "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function resetEmployeePassword(button) {
  const userId = button.dataset.passwordReset;
  if (!confirm("Reset this employee's password? Their current sessions will be invalidated.")) return;
  const done = setBusy(button, true, "Resetting…");
  try {
    const response = await api.request(`/admin/users/${encodeURIComponent(userId)}/password`, { method: "POST" });
    const result = adminData(response);
    openTemporaryPassword(result.temporaryPassword);
    await loadAdmin();
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

function openTemporaryPassword(password) {
  $("#temporary-password-value").value = password;
  $("#temporary-password-dialog").showModal();
}

function clearTemporaryPassword() {
  $("#temporary-password-value").value = "";
}

function checkboxMarkup(items, prefix, selectedIds = []) {
  if (!items.length) return '<span class="form-help">No websites available.</span>';
  return items.map((website) => {
    const id = Number(website.websiteId ?? website.website_id);
    const name = website.websiteName ?? website.website_name;
    return `<label><input type="checkbox" name="${prefix}" value="${esc(id)}" ${selectedIds.includes(id) ? "checked" : ""}>${esc(name)}</label>`;
  }).join("");
}

async function loadWebsiteAccess(userId) {
  const result = await api.request(`/admin/website-access/${encodeURIComponent(userId)}`);
  const data = adminData(result);
  const selected = (data.websites || []).filter((website) => website.canView).map((website) => website.websiteId);
  $("#access-websites").innerHTML = checkboxMarkup(data.websites || [], "accessWebsite", selected);
}

async function saveWebsiteAccess(event) {
  event.preventDefault();
  const userId = $("#access-member").value;
  if (!userId) return notice("Choose an employee first.", "error");
  const websiteIds = $$('input[name="accessWebsite"]:checked').map((input) => Number(input.value));
  const button = event.currentTarget.querySelector('[type="submit"]');
  const done = setBusy(button, true, "Saving…");
  try {
    await api.request(`/admin/website-access/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify({ websiteIds })
    });
    await loadAdmin();
    await loadWebsiteAccess(userId);
    notice("Website visibility assignments updated.", "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

function renderInvitations(invitations) {
  $("#invitations-table").innerHTML = invitations.length ? invitations.map((invitation) => `
    <tr><td>${esc(invitation.email)}</td><td>${esc(invitation.role)}</td>
    <td>${esc(invitation.status)}</td><td><span class="status-chip ${invitation.deliveryStatus === "failed" ? "delivery-failed" : esc(invitation.deliveryStatus || "")}">${esc(invitation.deliveryStatus || "pending")}</span></td>
    <td>${esc(invitation.expiresAt || "—")}</td><td class="admin-action-group">
      ${invitation.status === "pending" || invitation.status === "expired" ? `<button class="button button-outline" data-invitation-resend="${esc(invitation.id)}">Resend</button>` : ""}
      ${invitation.status === "pending" ? `<button class="button button-outline" data-invitation-revoke="${esc(invitation.id)}">Revoke</button>` : ""}</td></tr>`
  ).join("") : '<tr><td colspan="6" class="empty-cell">No invitations found.</td></tr>';
  $$("[data-invitation-resend]").forEach((button) => button.addEventListener("click", () => resendInvitation(button)));
  $$("[data-invitation-revoke]").forEach((button) => button.addEventListener("click", () => revokeInvitation(button)));
}

async function resendInvitation(button) {
  const done = setBusy(button, true, "Sending…");
  try {
    const response = await api.request(`/admin/invitations/${encodeURIComponent(button.dataset.invitationResend)}/resend`, { method: "POST", body: JSON.stringify({}) });
    const invitation = adminData(response);
    await loadAdmin();
    notice(invitation.deliveryStatus === "sent"
      ? `Invitation email sent to ${invitation.email}.`
      : `Invitation was recorded, but email delivery failed for ${invitation.email}.`, invitation.deliveryStatus === "sent" ? "success" : "error");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function revokeInvitation(button) {
  if (!confirm("Revoke this pending invitation?")) return;
  try {
    await api.request(`/admin/invitations/${encodeURIComponent(button.dataset.invitationRevoke)}`, { method: "DELETE" });
    await loadAdmin();
    notice("Invitation revoked.", "success");
  } catch (error) {
    handleError(error);
  }
}

function renderOrganizationSettings(settings) {
  $("#organization-label").textContent = `${settings.name} · ${settings.slug}`;
  $("#organization-name").value = settings.name || "";
  $("#organization-timezone").value = settings.defaultTimezone || "UTC";
  $("#invitation-expiry").value = settings.invitationExpiryHours;
  $("#analyst-exports").checked = Boolean(settings.reportExportsEnabled);
  $("#viewer-exports").checked = Boolean(settings.viewerExportsEnabled);
}

async function saveOrganizationSettings(event) {
  event.preventDefault();
  const body = {
    name: $("#organization-name").value.trim(),
    defaultTimezone: $("#organization-timezone").value.trim(),
    invitationExpiryHours: Number($("#invitation-expiry").value),
    reportExportsEnabled: $("#analyst-exports").checked,
    viewerExportsEnabled: $("#viewer-exports").checked
  };
  const button = event.currentTarget.querySelector('[type="submit"]');
  const done = setBusy(button, true, "Saving…");
  try {
    const response = await api.request("/admin/organization", { method: "PATCH", body: JSON.stringify(body) });
    const settings = adminData(response);
    renderOrganizationSettings(settings);
    if (state.user) {
      const session = await api.request("/auth/me");
      if (session.authenticated) showWorkspace(session);
    }
    notice("Organization settings saved.", "success");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

function renderIntegrations(integrations) {
  $("#integrations-table").innerHTML = integrations.length ? integrations.map((item) => `
    <tr><td>${esc(item.websiteName)}</td><td>${esc(item.connectionOwner?.email || "—")}</td>
    <td>${esc(item.connectedGoogleAccount || "—")}</td><td>${item.connected ? "Connected" : "Not connected"}</td>
    <td>${esc(item.lastSuccessfulSync || "—")}</td><td>${esc(item.connectionError || "—")}</td></tr>`
  ).join("") : '<tr><td colspan="6" class="empty-cell">No integrations found.</td></tr>';
}

function renderActivity(rows, pagination) {
  $("#activity-table").innerHTML = rows.length ? rows.map((entry) => {
    const metadata = parseObject(entry.metadata);
    return `<tr><td>${esc(entry.created_at || "—")}</td><td>${esc(entry.actor_name || entry.actor_user_id || "System")}</td>
      <td>${esc(entry.action)}</td><td>${esc(`${entry.resource_type || ""} ${entry.resource_id || ""}`)}</td>
      <td><code>${esc(JSON.stringify(metadata))}</code></td></tr>`;
  }).join("") : '<tr><td colspan="5" class="empty-cell">No activity for the current page.</td></tr>';
  const totalPages = Math.max(1, Math.ceil((pagination?.total || 0) / (pagination?.limit || 20)));
  $("#activity-page").textContent = `Page ${pagination?.page || 1} of ${totalPages}`;
  $("#activity-prev").disabled = (pagination?.page || 1) <= 1;
  $("#activity-next").disabled = (pagination?.page || 1) >= totalPages;
}

function fillAccessMembers(members) {
  const select = $("#access-member");
  const previous = select.value;
  select.innerHTML = '<option value="">Select employee…</option>' + members.map((member) => {
    const userId = member.id ?? member.userId ?? member.user_id;
    const username = member.username || member.email || "Google Admin";
    return `<option value="${esc(userId)}">${esc(member.name || member.displayName || member.display_name || username)} — ${esc(username)}</option>`;
  }).join("");
  if (members.some((member) => String(member.id ?? member.userId ?? member.user_id) === previous)) {
    select.value = previous;
  }
}

async function loadAdmin(search = $("#member-search").value.trim()) {
  if (state.membership?.role !== "admin") return;
  const controller = latestSignal("admin");
  $("#members-table").innerHTML = '<tr><td colspan="7" class="empty-cell">Loading organization data…</td></tr>';
  try {
    const results = await Promise.all([
      api.request("/admin/overview", { signal: controller.signal }),
      adminQuery("/admin/users", { search, page: 1, limit: 50, sortBy: "joined_at", order: "desc" }, controller.signal),
      adminQuery("/admin/invitations", { page: 1, limit: 50 }, controller.signal),
      api.request("/admin/websites", { signal: controller.signal }),
      api.request("/admin/integrations", { signal: controller.signal }),
      api.request("/admin/organization", { signal: controller.signal }),
      adminQuery("/admin/activity-logs", { page: state.activityPage, limit: 20, order: "desc" }, controller.signal)
    ]);
    if (!requestIsCurrent("admin", controller)) return;
    const overview = adminData(results[0]);
    const membersResponse = adminData(results[1]);
    const invitationsResponse = adminData(results[2]);
    const websites = adminData(results[3]) || [];
    const integrations = adminData(results[4]) || [];
    const settings = adminData(results[5]);
    const activity = adminData(results[6]);
    state.admin = { overview, members: membersResponse.data || [], invitations: invitationsResponse.data || [], websites, integrations, settings };
    renderAdminOverview(overview);
    renderAdminWebsites(websites);
    renderMemberTable(state.admin.members);
    fillAccessMembers(state.admin.members);
    $("#employee-websites").innerHTML = checkboxMarkup(websites, "employeeWebsite");
    renderInvitations(state.admin.invitations);
    renderIntegrations(integrations);
    renderOrganizationSettings(settings);
    renderActivity(activity.data || [], activity.pagination);
  } finally {
    if (activeRequests.get("admin") === controller) activeRequests.delete("admin");
  }
}

async function createInvitation(event) {
  event.preventDefault();
  if (state.membership?.role !== "admin") return notice("Only organization Admins can invite employees.", "error");
  const form = event.currentTarget;
  const email = $("#invite-email").value.trim();
  const websiteIds = $$('input[name="inviteWebsite"]:checked').map((input) => Number(input.value));
  const button = form.querySelector('[type="submit"]');
  const done = setBusy(button, true, "Creating invitation…");
  try {
    const response = await api.request("/admin/users/invite", {
      method: "POST",
      body: JSON.stringify({ email, role: $("#invite-role").value, websiteIds })
    });
    const invitation = adminData(response);
    form.reset();
    await loadAdmin();
    if (invitation.deliveryStatus === "sent") {
      notice(`Invitation created and email sent to ${invitation.email}.`, "success");
    } else {
      notice(`Invitation created for ${invitation.email}, but email delivery failed. It was not sent; an Admin can resend it.`, "error");
    }
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function createEmployeeAccount(event) {
  event.preventDefault();
  if (state.membership?.role !== "admin") return notice("Only organization Admins can create employee accounts.", "error");
  const form = event.currentTarget;
  const websiteIds = $$('input[name="employeeWebsite"]:checked').map((input) => Number(input.value));
  if (!websiteIds.length) return notice("Assign at least one website to the employee.", "error");
  const password = $("#employee-create-password").value;
  const body = {
    name: $("#employee-name").value.trim(),
    username: $("#employee-create-username").value.trim(),
    role: $("#employee-role").value,
    websiteIds,
    ...(password ? { password } : {})
  };
  const button = form.querySelector('[type="submit"]');
  const done = setBusy(button, true, "Creating account…");
  try {
    const response = await api.request("/admin/users", {
      method: "POST",
      body: JSON.stringify(body)
    });
    const employee = adminData(response);
    form.reset();
    await loadAdmin();
    if (employee.temporaryPassword) {
      openTemporaryPassword(employee.temporaryPassword);
    } else {
      notice(`Employee account ${employee.username} created.`, "success");
    }
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function employeeLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const done = setBusy(button, true, "Signing in…");
  try {
    await api.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#employee-username").value.trim(),
        password: $("#employee-password").value
      })
    });
    form.reset();
    window.location.reload();
  } catch (error) {
    $("#auth-gate-message").textContent = error?.message || "Sign-in failed. Check your credentials and try again.";
  } finally {
    done();
  }
}

async function changeTemporaryPassword(event) {
  event.preventDefault();
  const password = $("#new-password").value;
  if (password !== $("#confirm-new-password").value) {
    $("#auth-gate-message").textContent = "The new passwords do not match.";
    return;
  }
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const done = setBusy(button, true, "Updating password…");
  try {
    await api.request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    form.reset();
    window.location.reload();
  } catch (error) {
    $("#auth-gate-message").textContent = error?.message || "Password update failed. Please try again.";
  } finally {
    done();
  }
}

async function loadCurrentView() {
  hideNotice();
  try {
    await refreshReports();
    if (state.currentView === "acquisition") await loadAcquisition();
    if (state.currentView === "combined") await loadCombinedReport();
    if (state.currentView === "keywords") await loadKeywords();
    if (state.currentView === "websites") await loadWebsites();
    if (state.currentView === "sync") await loadJobs();
    if (state.currentView === "admin") await loadAdmin();
  } catch (error) {
    handleError(error);
  }
}

function switchView(view) {
  if (!viewCopy[view] || (view === "admin" && state.membership?.role !== "admin")) return;
  state.currentView = view;
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((element) => element.classList.add("hidden"));
  $(`#view-${view}`).classList.remove("hidden");
  $("#breadcrumb-current").textContent = viewCopy[view][0];
  $("#page-title").textContent = viewCopy[view][0];
  $("#page-description").textContent = viewCopy[view][1];
  $("#sidebar").classList.remove("open");
  loadCurrentView();
}

async function loadSession() {
  const session = await api.request("/auth/me");
  if (!session.authenticated) {
    showAuthGate();
    return false;
  }
  if (session.organizationContextRequired || !session.organization || !session.membership) {
    showAuthGate("Your account does not have a single active organization context. Contact an organization Admin.");
    return false;
  }
  if (session.mustChangePassword) {
    showPasswordChangeGate();
    return false;
  }
  showWorkspace(session);
  return true;
}

async function logout() {
  const button = $("#logout-button");
  const done = setBusy(button, true, "Signing out…");
  try {
    await api.request("/auth/logout", { method: "POST" });
    state.websites = [];
    state.overview = null;
    sessionStorage.removeItem("seo-selected-website");
    showAuthGate("You have been signed out.");
  } catch (error) {
    handleError(error);
  } finally {
    done();
  }
}

async function checkBackend() {
  try {
    const base = API_BASE.replace(/\/api$/, "");
    const response = await fetch(`${base}/health`, { credentials: "include" });
    if (!response.ok) throw new Error(`Health check returned ${response.status}`);
    const data = await response.json();
    setConnection(true, data.database === "connected" ? "Backend connected" : "Backend online");
  } catch (error) {
    setConnection(false, "Backend unavailable");
    console.error("Backend health check failed:", error);
  }
}

function setComparisonControls() {
  const enabled = $("#compare-period").checked;
  $("#comparison-mode").classList.toggle("hidden", !enabled);
  $("#comparison-dates").classList.toggle("hidden", !enabled || $("#comparison-mode").value !== "custom");
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$("[data-go]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.go)));
  $("#menu-button").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#auth-login").addEventListener("click", () => window.location.assign(`${API_BASE}/auth/google`));
  $("#google-login").addEventListener("click", () => window.location.assign(`${API_BASE}/auth/google`));
  $("#employee-login-form").addEventListener("submit", employeeLogin);
  $("#password-change-form").addEventListener("submit", changeTemporaryPassword);
  $("#logout-button").addEventListener("click", logout);
  $("#website-select").addEventListener("change", async () => {
    const selected = siteId();
    if (selected) sessionStorage.setItem("seo-selected-website", selected);
    else sessionStorage.removeItem("seo-selected-website");
    cancelRequest("reports");
    cancelRequest("acquisition");
    cancelRequest("combined");
    cancelRequest("keywords");
    cancelRequest("keyword-history");
    await loadCurrentView();
  });
  $("#apply-filters").addEventListener("click", loadCurrentView);
  $("#date-preset").addEventListener("change", (event) => {
    if (event.target.value === "custom") return;
    setDefaultDates(Number(event.target.value));
  });
  $("#start-date").addEventListener("change", () => { $("#date-preset").value = "custom"; });
  $("#end-date").addEventListener("change", () => { $("#date-preset").value = "custom"; });
  $("#compare-period").addEventListener("change", () => {
    setComparisonControls();
    loadCurrentView();
  });
  $("#comparison-mode").addEventListener("change", () => {
    setComparisonControls();
    if ($("#compare-period").checked && $("#comparison-mode").value !== "custom") loadCurrentView();
  });
  $("#acquisition-type").addEventListener("change", () => loadAcquisition().catch(handleError));
  $("#acquisition-dimension").addEventListener("change", () => loadAcquisition().catch(handleError));
  $("#acquisition-search").addEventListener("input", renderAcquisition);
  $("#acquisition-channel").addEventListener("change", renderAcquisition);
  $("#reset-acquisition-filters").addEventListener("click", () => {
    $("#acquisition-search").value = "";
    $("#acquisition-channel").value = "";
    renderAcquisition();
  });
  $("#keyword-form").addEventListener("submit", addKeyword);
  $("#keyword-select").addEventListener("change", () => loadKeywordHistory().catch(handleError));
  $("#sync-keyword-history").addEventListener("click", () => syncKeywordHistory());
  $("#export-keyword-history").addEventListener("click", (event) => exportReport("keyword_tracking", event.currentTarget));
  $("#open-add-website").addEventListener("click", openDialog);
  $("#close-website-dialog").addEventListener("click", closeDialog);
  $("#cancel-website").addEventListener("click", closeDialog);
  $("#website-form").addEventListener("submit", createWebsite);
  $("#refresh-jobs").addEventListener("click", () => loadJobs().catch(handleError));
  $$(".export-button").forEach((button) => button.addEventListener("click", () => exportReport(button.dataset.export, button)));
  $("#website-dialog").addEventListener("click", (event) => {
    if (event.target === $("#website-dialog")) closeDialog();
  });
  $("#employee-create-form").addEventListener("submit", createEmployeeAccount);
  $("#invite-form").addEventListener("submit", createInvitation);
  $("#close-temporary-password").addEventListener("click", () => $("#temporary-password-dialog").close());
  $("#done-temporary-password").addEventListener("click", () => $("#temporary-password-dialog").close());
  $("#temporary-password-dialog").addEventListener("close", clearTemporaryPassword);
  $("#copy-temporary-password").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#temporary-password-value").value);
      notice("Temporary password copied. It will be cleared when this dialog closes.", "success");
    } catch (error) {
      handleError(error);
    }
  });
  $("#organization-form").addEventListener("submit", saveOrganizationSettings);
  $("#website-access-form").addEventListener("submit", saveWebsiteAccess);
  $("#access-member").addEventListener("change", (event) => {
    if (event.target.value) loadWebsiteAccess(event.target.value).catch(handleError);
    else $("#access-websites").innerHTML = "";
  });
  $("#member-search").addEventListener("input", () => {
    clearTimeout(window.memberSearchTimer);
    window.memberSearchTimer = setTimeout(() => loadAdmin($("#member-search").value.trim()).catch(handleError), 250);
  });
  $("#activity-prev").addEventListener("click", () => {
    state.activityPage = Math.max(1, state.activityPage - 1);
    loadAdmin().catch(handleError);
  });
  $("#activity-next").addEventListener("click", () => {
    state.activityPage += 1;
    loadAdmin().catch(handleError);
  });
}

async function boot() {
  setDefaultDates(28);
  bindEvents();
  setComparisonControls();
  await checkBackend();
  try {
    const authenticated = await loadSession();
    if (!authenticated) return;
    await loadWebsites();
    if (!state.websites.length && state.permissions.canCreateWebsites) {
      $("#overview-summary").innerHTML = '<div class="empty-state"><strong>Add your first website</strong><p>Use the Websites page to connect analytics properties. The backend will queue historical imports.</p></div>';
    }
    await loadCurrentView();
  } catch (error) {
    handleError(error);
  }
}

document.addEventListener("DOMContentLoaded", boot);
