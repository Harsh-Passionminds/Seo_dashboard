(function attachApiClient(global) {
  const defaultBase = (global.API_BASE || "http://localhost:4000/api").replace(/\/+$/, "");

  function messageForStatus(status, detail) {
    if (status === 401) return "Your session has expired. Sign in to continue.";
    if (status === 403) return detail || "You do not have permission to perform this action.";
    if (status === 404) return detail || "The requested resource was not found.";
    if (status === 409) return detail || "This change conflicts with the current account state.";
    if (status === 429) return "Too many requests. Wait a moment and try again.";
    if (status >= 500) return "The server could not complete the request. Please try again.";
    if (status >= 400) return detail || "Please check the submitted information and try again.";
    return detail || "The request could not be completed.";
  }

  function responseDetail(body) {
    if (typeof body === "string") return body;
    if (!body || typeof body !== "object") return "";
    return body.error?.message || body.message || body.error?.code || body.code || "";
  }

  function safeFilename(value) {
    return String(value || "download")
      .replace(/[\\/\u0000-\u001f\u007f"]/g, "_")
      .replace(/^\.+$/, "download")
      .slice(0, 180) || "download";
  }

  function filenameFromDisposition(value) {
    if (!value) return null;
    const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (encoded) {
      try {
        return safeFilename(decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, "")));
      } catch {
        return safeFilename(encoded[1]);
      }
    }
    const plain = value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
    return plain ? safeFilename((plain[1] || plain[2]).trim()) : null;
  }

  function createApiClient({
    baseUrl = defaultBase,
    fetchImpl = global.fetch.bind(global),
    onUnauthorized = () => {},
    defaultTimeoutMs = 15000
  } = {}) {
    const base = String(baseUrl).replace(/\/+$/, "");

    function buildUrl(path, query) {
      const url = new URL(`${base}${path}`, global.location?.href || "http://localhost/");
      if (query) {
        const params = query instanceof URLSearchParams
          ? query
          : new URLSearchParams(Object.entries(query).flatMap(([key, value]) => {
              if (value === undefined || value === null || value === "") return [];
              return [[key, typeof value === "object" ? JSON.stringify(value) : String(value)]];
            }));
        for (const [key, value] of params) url.searchParams.set(key, value);
      }
      return url.href;
    }

    async function send(path, options = {}) {
      const {
        query,
        timeoutMs = defaultTimeoutMs,
        signal: externalSignal,
        ...fetchOptions
      } = options;
      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => controller.abort(externalSignal.reason);
      if (externalSignal?.aborted) abortFromCaller();
      else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : null;

      try {
        return await fetchImpl(buildUrl(path, query), {
          ...fetchOptions,
          credentials: "include",
          signal: controller.signal,
          headers: {
            ...(fetchOptions.body && typeof fetchOptions.body === "string"
              ? { "Content-Type": "application/json" }
              : {}),
            ...fetchOptions.headers
          }
        });
      } catch (error) {
        if (timedOut) {
          throw new ApiError(0, "REQUEST_TIMEOUT", "The request timed out. Check your connection and try again.");
        }
        if (externalSignal?.aborted) throw error;
        throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection and try again.", {
          cause: error
        });
      } finally {
        if (timer !== null) clearTimeout(timer);
        externalSignal?.removeEventListener("abort", abortFromCaller);
      }
    }

    async function parseError(response) {
      const contentType = response.headers?.get?.("content-type") || "";
      let body = null;
      try {
        body = contentType.includes("json") ? await response.json() : await response.text();
      } catch {
        body = null;
      }
      const detail = responseDetail(body);
      const error = new ApiError(
        response.status,
        body?.error?.code || body?.code || `HTTP_${response.status}`,
        messageForStatus(response.status, detail),
        { body, responseMessage: detail }
      );
      if (response.status === 401) onUnauthorized(error);
      throw error;
    }

    async function request(path, options = {}) {
      const response = await send(path, options);
      if (!response.ok) return parseError(response);
      if (response.status === 204) return null;
      const contentType = response.headers?.get?.("content-type") || "";
      if (contentType.includes("json")) return response.json();
      return response.text();
    }

    async function download(path, options = {}) {
      const response = await send(path, options);
      if (!response.ok) return parseError(response);
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers?.get?.("content-disposition")) ||
        "report-download";
      const objectUrl = global.URL.createObjectURL(blob);
      const link = global.document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      global.document.body.appendChild(link);
      link.click();
      link.remove();
      global.setTimeout(() => global.URL.revokeObjectURL(objectUrl), 1000);
      return { filename, size: blob.size, type: blob.type };
    }

    return { request, download, buildUrl };
  }

  class ApiError extends Error {
    constructor(status, code, message, details = {}) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  global.ApiClient = { createApiClient, ApiError, filenameFromDisposition };
})(window);
