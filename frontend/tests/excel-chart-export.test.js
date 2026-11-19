import assert from "node:assert/strict";
import test from "node:test";
import {
  renderLineChartToPng,
  renderBarChartToPng,
  buildExcelReportWithCharts
} from "../src/utils/excel-chart-export.js";
import { getExcelJS } from "../src/utils/exceljs-loader.js";

test("renderLineChartToPng generates valid base64 PNG data", () => {
  const png = renderLineChartToPng({
    title: "GSC Clicks Trend",
    subtitle: "2026-11-01 to 2026-11-17",
    labels: ["2026-11-01", "2026-11-02", "2026-11-03"],
    series: [
      { name: "Clicks", color: "#4285f4", data: [12, 18, 25] }
    ]
  });
  assert.ok(png);
  assert.equal(typeof png, "string");
  assert.ok(png.length > 50);
});

test("renderBarChartToPng generates valid base64 PNG data", () => {
  const png = renderBarChartToPng({
    title: "Traffic by Channel",
    categories: ["Direct", "Organic Search", "Referral"],
    series: [
      { name: "Sessions", color: "#4285f4", data: [100, 250, 45] }
    ]
  });
  assert.ok(png);
  assert.equal(typeof png, "string");
  assert.ok(png.length > 50);
});

test("buildExcelReportWithCharts embeds overview sheet and charts for GSC comparison", async () => {
  const ExcelJS = await getExcelJS();
  const buffer = await buildExcelReportWithCharts({
    websiteName: "Acme Corp",
    source: "gsc",
    startDate: "2026-11-01",
    endDate: "2026-11-17",
    comparisonPeriod: { startDate: "2026-10-15", endDate: "2026-10-31" },
    summary: {
      clicks: { currentValue: 120, previousValue: 95, absoluteChange: 25, percentageChange: 26.3 },
      impressions: { currentValue: 2400, previousValue: 2000, absoluteChange: 400, percentageChange: 20.0 },
      ctr: { currentValue: 0.05, previousValue: 0.0475, absoluteChange: 0.0025, percentageChange: 5.3 },
      average_position: { currentValue: 8.2, previousValue: 9.6, absoluteChange: -1.4, percentageChange: -14.6 }
    },
    reportResult: {
      data: {
        current: [
          { report_date: "2026-11-01", clicks: 10, impressions: 200, average_position: 8.5 },
          { report_date: "2026-11-02", clicks: 15, impressions: 250, average_position: 8.1 }
        ],
        comparison: [
          { report_date: "2026-10-15", clicks: 8, impressions: 180, average_position: 9.8 },
          { report_date: "2026-10-16", clicks: 11, impressions: 190, average_position: 9.5 }
        ]
      }
    }
  });

  assert.ok(buffer);
  assert.ok(buffer.byteLength > 1000);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const overview = wb.getWorksheet("Overview & Charts");
  assert.ok(overview, "Overview & Charts worksheet should exist");
  assert.match(overview.getCell("B1").value, /GSC/i);
  assert.match(overview.getCell("B2").value, /Acme Corp/);
  assert.match(overview.getCell("B3").value, /2026-11-01 to 2026-11-17/);

  // Check images embedded in Overview sheet
  const images = overview.getImages();
  assert.ok(images.length >= 1, "Should have embedded chart images in Overview & Charts");
});

test("buildExcelReportWithCharts enriches backend XLSX buffer while preserving existing sheets", async () => {
  const ExcelJS = await getExcelJS();
  // Simulate backend XLSX
  const backendWb = new ExcelJS.Workbook();
  const reportWs = backendWb.addWorksheet("Report");
  reportWs.addRow(["GSC report"]);
  reportWs.addRow(["Website: Test Site"]);
  reportWs.addRow(["Reporting period: 2026-11-01 to 2026-11-17"]);
  reportWs.addRow(["Date", "Clicks", "Impressions"]);
  reportWs.addRow(["2026-11-01", 10, 200]);
  reportWs.addRow(["2026-11-02", 15, 250]);
  const backendBuffer = await backendWb.xlsx.writeBuffer();

  const enriched = await buildExcelReportWithCharts({
    existingBuffer: backendBuffer,
    websiteName: "Test Site",
    source: "gsc",
    startDate: "2026-11-01",
    endDate: "2026-11-17",
    summary: { clicks: 25, impressions: 450 },
    reportResult: {
      data: {
        current: [
          { date: "2026-11-01", clicks: 10, impressions: 200 },
          { date: "2026-11-02", clicks: 15, impressions: 250 }
        ]
      }
    }
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(enriched);

  assert.ok(wb.getWorksheet("Report"), "Original Report sheet must be preserved");
  assert.ok(wb.getWorksheet("Overview & Charts"), "Overview & Charts sheet must be added");
  assert.equal(wb.getWorksheet("Report").getCell("A4").value, "Date");
  assert.equal(wb.getWorksheet("Report").getCell("B5").value, 10);

  // Charts should be in Overview and in Report sheet
  assert.ok(wb.getWorksheet("Overview & Charts").getImages().length >= 1);
  assert.ok(wb.getWorksheet("Report").getImages().length >= 1);
});

test("buildExcelReportWithCharts handles Combined reports with GSC, GA4, and Keywords", async () => {
  const ExcelJS = await getExcelJS();
  const backendWb = new ExcelJS.Workbook();
  backendWb.addWorksheet("GSC").addRow(["Date", "Clicks"]);
  backendWb.addWorksheet("GA4").addRow(["Date", "Organic sessions"]);
  backendWb.addWorksheet("Keywords").addRow(["Keyword", "Clicks"]);
  const backendBuffer = await backendWb.xlsx.writeBuffer();

  const enriched = await buildExcelReportWithCharts({
    existingBuffer: backendBuffer,
    websiteName: "Test Site",
    source: "combined",
    startDate: "2026-11-01",
    endDate: "2026-11-17",
    summary: { clicks: 100, organic_sessions: 250 },
    reportResult: {
      source: "combined",
      sections: {
        gsc: {
          data: {
            current: [
              { date: "2026-11-01", clicks: 10, impressions: 100 },
              { date: "2026-11-02", clicks: 20, impressions: 200 }
            ]
          }
        },
        ga4: {
          data: {
            current: [
              { date: "2026-11-01", organic_sessions: 30, total_form_conversions: 5 },
              { date: "2026-11-02", organic_sessions: 40, total_form_conversions: 8 }
            ]
          }
        },
        keyword_tracking: {
          data: {
            current: [
              { keyword: "seo consultant", clicks: 15, impressions: 150 },
              { keyword: "seo agency", clicks: 25, impressions: 300 }
            ]
          }
        }
      }
    }
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(enriched);

  assert.ok(wb.getWorksheet("Overview & Charts"));
  assert.ok(wb.getWorksheet("GSC"));
  assert.ok(wb.getWorksheet("GA4"));
  assert.ok(wb.getWorksheet("Keywords"));

  // Check multiple charts embedded for combined report
  const overviewImages = wb.getWorksheet("Overview & Charts").getImages();
  assert.ok(overviewImages.length >= 3, "Combined report should have charts for GSC, GA4, and Keywords");
});
