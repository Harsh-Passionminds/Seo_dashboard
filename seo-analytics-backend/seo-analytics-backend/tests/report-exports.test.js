import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { createRequireReportExportPermission } from "../src/middleware/report-export-access.js";
import { createReportExportService, createReportFilename, escapeCsvValue } from "../src/services/report-export.service.js";

const website = {
  website_id: 12,
  owner_user_id: 7,
  website_name: "Example Website"
};
const baseExport = {
  website,
  userId: 7,
  organizationId: 3,
  source: "gsc",
  startDate: "2026-11-01",
  endDate: "2026-11-17",
  metrics: ["clicks", "ctr"],
  dimensions: ["date"],
  filters: {},
  sortBy: "date",
  order: "asc"
};

function createPolicyDb(policy) {
  return {
    async getReportExportPolicy() {
      return policy;
    }
  };
}

async function authorize(policy) {
  const middleware = createRequireReportExportPermission(createPolicyDb(policy));
  const req = {
    organization: { organization_id: 3 },
    user: { user_id: 7 },
    website: { website_id: 12 }
  };
  let nextError;
  await middleware(req, {}, (error) => {
    nextError = error;
  });
  return { req, nextError };
}

test("export authorization allows Admin regardless of policy and Analyst when enabled", async () => {
  const admin = await authorize({
    role: "admin",
    report_exports_enabled: 0,
    viewer_exports_enabled: 0
  });
  const analyst = await authorize({
    role: "analyst",
    report_exports_enabled: 1,
    viewer_exports_enabled: 0
  });
  assert.equal(admin.nextError, undefined);
  assert.equal(analyst.nextError, undefined);
});

test("Viewer exports are denied by default and allowed only by explicit organization policy", async () => {
  const denied = await authorize({
    role: "viewer",
    report_exports_enabled: 1,
    viewer_exports_enabled: 0
  });
  const allowed = await authorize({
    role: "viewer",
    report_exports_enabled: 0,
    viewer_exports_enabled: 1
  });
  assert.equal(denied.nextError.status, 403);
  assert.equal(denied.nextError.code, "REPORT_EXPORT_FORBIDDEN");
  assert.equal(allowed.nextError, undefined);
});

test("missing website membership policy is hidden as not found", async () => {
  const result = await authorize(null);
  assert.equal(result.nextError.status, 404);
  assert.equal(result.nextError.code, "WEBSITE_NOT_FOUND");
});

test("CSV escaping quotes commas, quotes and line breaks and protects formula text", () => {
  assert.equal(escapeCsvValue("label, with comma"), '"label, with comma"');
  assert.equal(escapeCsvValue('say "hello"'), '"say ""hello"""');
  assert.equal(escapeCsvValue("two\nlines"), '"two\nlines"');
  assert.equal(escapeCsvValue("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(escapeCsvValue(-2, { text: false }), "-2");
});

test("safe export filenames contain only bounded ASCII filename characters", () => {
  assert.equal(
    createReportFilename({
      websiteName: 'A "Website" / North',
      source: "gsc",
      startDate: "2026-11-01",
      endDate: "2026-11-17",
      format: "csv"
    }),
    "A-Website-North-gsc-2026-11-01-to-2026-11-17.csv"
  );
});

test("CSV export contains selected metrics, escaped text, formula protection and real activity logging", async () => {
  const activity = [];
  const service = createReportExportService({
    dataService: {
      async getSourceRows() {
        return [
          {
            report_date: "2026-11-01",
            clicks: 7,
            ctr: 0.125,
            keyword: '=HYPERLINK("https://bad.example")'
          }
        ];
      }
    },
    repository: {
      async recordReportExport(event) {
        activity.push(event);
      }
    }
  });
  const output = await service.generate({
    ...baseExport,
    source: "keyword_tracking",
    metrics: ["clicks", "ctr"],
    dimensions: ["date", "keyword"]
  });
  try {
    const csv = await readFile(output.filePath, "utf8");
    assert.equal(output.contentType, "text/csv; charset=utf-8");
    assert.match(csv, /Date,Keyword,Clicks,Click-through rate/);
    assert.match(csv, /2026-11-01,"'=HYPERLINK\(""https:\/\/bad\.example""\)",7,0\.125/);
    assert.equal(output.rowCount, 1);
    assert.equal(activity.length, 1);
    assert.deepEqual(
      {
        websiteId: activity[0].websiteId,
        source: activity[0].source,
        format: activity[0].format,
        startDate: activity[0].startDate,
        endDate: activity[0].endDate
      },
      {
        websiteId: 12,
        source: "keyword_tracking",
        format: "csv",
        startDate: "2026-11-01",
        endDate: "2026-11-17"
      }
    );
    assert.equal("oauthToken" in activity[0], false);
  } finally {
    await service.cleanup(output);
  }
});

test("XLSX export opens with worksheet, title, headers, dates, numeric cells, and empty datasets", async () => {
  const service = createReportExportService({
    dataService: {
      async getSourceRows() {
        return [{ report_date: "2026-11-01", clicks: 9, ctr: 0.25 }];
      }
    },
    repository: { async recordReportExport() {} }
  });
  const output = await service.generate({
    ...baseExport,
    format: "xlsx",
    dimensions: ["date"]
  });
  try {
    assert.equal(
      output.contentType,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert.match(output.filename, /\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(output.filePath);
    const sheet = workbook.getWorksheet("Report");
    assert.ok(sheet);
    assert.match(sheet.getCell("A1").value, /GSC report/);
    assert.match(sheet.getCell("A3").value, /2026-11-01 to 2026-11-17/);
    assert.equal(sheet.getCell("A4").value, "Date");
    assert.equal(sheet.getCell("B4").value, "Clicks");
    assert.equal(sheet.getCell("C4").value, "Click-through rate");
    assert.equal(sheet.getCell("A5").value instanceof Date, true);
    assert.equal(typeof sheet.getCell("B5").value, "number");
    assert.equal(typeof sheet.getCell("C5").value, "number");
    assert.equal(sheet.getCell("C5").numFmt, "0.00%");
  } finally {
    await service.cleanup(output);
  }

  const emptyService = createReportExportService({
    dataService: { async getSourceRows() { return []; } },
    repository: { async recordReportExport() {} }
  });
  const emptyOutput = await emptyService.generate({ ...baseExport, format: "xlsx" });
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(emptyOutput.filePath);
    assert.equal(workbook.getWorksheet("Report").rowCount, 4);
    assert.equal(emptyOutput.rowCount, 0);
  } finally {
    await emptyService.cleanup(emptyOutput);
  }
});

test("empty CSV exports still contain the requested headers", async () => {
  const service = createReportExportService({
    dataService: { async getSourceRows() { return []; } },
    repository: { async recordReportExport() {} }
  });
  const output = await service.generate({ ...baseExport, format: "csv" });
  try {
    const csv = await readFile(output.filePath, "utf8");
    assert.match(csv, /Date,Clicks,Click-through rate/);
    assert.equal(output.rowCount, 0);
  } finally {
    await service.cleanup(output);
  }
});
