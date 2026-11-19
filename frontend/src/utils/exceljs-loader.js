let ExcelJSModule = null;

export async function getExcelJS() {
  if (ExcelJSModule) return ExcelJSModule;

  if (typeof window !== "undefined") {
    const mod = await import("exceljs");
    ExcelJSModule = mod.default || mod;
    return ExcelJSModule;
  }

  // Running in Node environment (e.g. node --test)
  try {
    const mod = await import("exceljs");
    ExcelJSModule = mod.default || mod;
    return ExcelJSModule;
  } catch {
    const { createRequire } = await import("node:module");
    const path = (await import("node:path")).default;
    const { fileURLToPath } = await import("node:url");
    const require = createRequire(import.meta.url);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const backendExcelJsPath = path.resolve(
      __dirname,
      "../../../seo-analytics-backend/seo-analytics-backend/node_modules/exceljs/dist/exceljs.min.js"
    );
    ExcelJSModule = require(backendExcelJsPath);
    return ExcelJSModule;
  }
}

export default getExcelJS;
