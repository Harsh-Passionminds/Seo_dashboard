const API_BASE = (import.meta?.env?.VITE_API_BASE_URL || (typeof process !== "undefined" ? process.env?.VITE_API_BASE_URL : "") || "/api").replace(/\/+$/, "");

export const apiUrl = (path) => `${API_BASE}${path}`;

export async function api(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    ...options,
    credentials: "include",
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (res.status === 204) return null;
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(body?.error?.message || body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body?.error?.code || body?.code;
    throw err;
  }
  return body;
}

export async function download(path) {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      msg = b?.error?.message || b?.message || msg;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = m ? decodeURIComponent(m[1]) : "report";
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function fetchDownload(path) {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      msg = b?.error?.message || b?.message || msg;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = m ? decodeURIComponent(m[1]) : "report.xlsx";
  const buffer = await res.arrayBuffer();
  return { buffer, filename, contentType: res.headers.get("content-type") };
}

export function triggerBlobDownload(data, filename, mimeType = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
