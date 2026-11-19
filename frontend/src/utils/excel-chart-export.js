import { getExcelJS } from "./exceljs-loader.js";
import { buildReportChartSeries } from "./report-series.js";
import { toNum } from "./format.js";
import { fetchReportExport, getReportComparison } from "../services/endpoints.js";
import { triggerBlobDownload } from "../services/api.js";


// Metric colors matching UI
export const METRIC_COLORS = {
  clicks: "#4285f4",
  impressions: "#5e35b1",
  ctr: "#0b8043",
  average_position: "#e8710a",
  organic_sessions: "#4285f4",
  sessions: "#4285f4",
  engagedSessions: "#5e35b1",
  engagementRate: "#0b8043",
  form_submit_conversions: "#0b8043",
  from_submit_conversions: "#0b8043",
  total_form_conversions: "#0b8043",
  conversions: "#0b8043",
  totalUsers: "#4285f4",
  newUsers: "#5e35b1",
  activeUsers: "#0b8043",
  totalRevenue: "#137333",
  averageSessionDuration: "#e8710a",
  current: "#4285f4",
  comparison: "#9aa0a6",
  previous: "#9aa0a6"
};

const METRIC_LABELS = {
  clicks: "Clicks",
  impressions: "Impressions",
  ctr: "Click-through rate (CTR)",
  average_position: "Average Position",
  organic_sessions: "Organic Sessions",
  sessions: "Sessions",
  engagedSessions: "Engaged Sessions",
  engagementRate: "Engagement Rate",
  form_submit_conversions: "Form Submissions",
  from_submit_conversions: "From Submissions",
  total_form_conversions: "Total Form Conversions",
  conversions: "Conversions",
  totalUsers: "Total Users",
  newUsers: "New Users",
  activeUsers: "Active Users",
  totalRevenue: "Total Revenue",
  averageSessionDuration: "Avg Session Duration (s)"
};

function formatValue(key, val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return "—";
  const num = Number(val);
  if (/ctr|rate/i.test(key)) {
    return (num * (Math.abs(num) <= 1 ? 100 : 1)).toFixed(1) + "%";
  }
  if (/position/i.test(key)) {
    return num.toFixed(1);
  }
  if (/revenue/i.test(key)) {
    return "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return Number.isInteger(num) ? num.toLocaleString() : num.toFixed(1);
}

/**
 * Creates an in-memory 2D canvas (browser or mock fallback)
 */
function createCanvas(width, height) {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  // Minimal mock for node testing environment
  return {
    width,
    height,
    getContext() {
      return {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        font: "",
        textAlign: "",
        textBaseline: "",
        fillRect() {},
        strokeRect() {},
        clearRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        fill() {},
        stroke() {},
        setLineDash() {},
        fillText() {},
        measureText(text) { return { width: (text || "").length * 7 }; }
      };
    },
    toDataURL() {
      // 1x1 transparent PNG base64 for tests
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    }
  };
}

/**
 * Render a line chart to Base64 PNG
 */
export function renderLineChartToPng({
  title = "Performance Trend",
  subtitle = "",
  labels = [],
  series = [],
  width = 900,
  height = 450,
  reversed = false,
  formatType = "int"
}) {
  const dpr = 2;
  const canvas = createCanvas(width * dpr, height * dpr);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width * dpr, height * dpr);

  // Border & card style
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(10 * dpr, 10 * dpr, (width - 20) * dpr, (height - 20) * dpr);

  // Header Title
  ctx.fillStyle = "#111827";
  ctx.font = `bold ${16 * dpr}px sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(title, 28 * dpr, 36 * dpr);

  if (subtitle) {
    ctx.fillStyle = "#6b7280";
    ctx.font = `${12 * dpr}px sans-serif`;
    ctx.fillText(subtitle, 28 * dpr, 54 * dpr);
  }

  // Active series with data
  const validSeries = series.filter((s) => Array.isArray(s.data) && s.data.length > 0);
  if (!validSeries.length || !labels.length) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = `${14 * dpr}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No chart data available for this selection", (width / 2) * dpr, (height / 2) * dpr);
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  }

  // Draw Legend in top right
  let legendX = (width - 30) * dpr;
  const legendY = 36 * dpr;
  ctx.font = `${11 * dpr}px sans-serif`;
  ctx.textAlign = "right";

  for (let i = validSeries.length - 1; i >= 0; i--) {
    const s = validSeries[i];
    const textWidth = ctx.measureText(s.name).width;
    ctx.fillStyle = "#374151";
    ctx.fillText(s.name, legendX, legendY);

    legendX -= textWidth + 8 * dpr;
    ctx.fillStyle = s.color || "#4285f4";
    ctx.beginPath();
    ctx.arc(legendX - 4 * dpr, legendY - 4 * dpr, 4 * dpr, 0, Math.PI * 2);
    ctx.fill();

    legendX -= 18 * dpr;
  }

  // Chart plotting area
  const paddingLeft = 65 * dpr;
  const paddingRight = 35 * dpr;
  const paddingTop = 75 * dpr;
  const paddingBottom = 45 * dpr;

  const plotWidth = (width * dpr) - paddingLeft - paddingRight;
  const plotHeight = (height * dpr) - paddingTop - paddingBottom;

  // Calculate Value Range (Min & Max)
  let allValues = [];
  validSeries.forEach((s) => {
    s.data.forEach((v) => {
      if (v !== null && v !== undefined && Number.isFinite(Number(v))) {
        allValues.push(Number(v));
      }
    });
  });

  if (!allValues.length) allValues = [0];
  let minVal = Math.min(...allValues);
  let maxVal = Math.max(...allValues);

  if (minVal === maxVal) {
    if (minVal === 0) {
      maxVal = 10;
    } else {
      minVal = minVal > 0 ? 0 : minVal * 1.2;
      maxVal = maxVal * 1.2;
    }
  } else {
    const span = maxVal - minVal;
    if (minVal > 0 && !reversed) minVal = 0;
    else if (!reversed) minVal -= span * 0.05;
    maxVal += span * 0.08;
  }

  // Y-axis gridlines and labels (5 steps)
  const steps = 4;
  ctx.font = `${10 * dpr}px sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const y = paddingTop + plotHeight * (1 - ratio);
    const value = reversed ? maxVal - ratio * (maxVal - minVal) : minVal + ratio * (maxVal - minVal);

    // Gridline
    ctx.strokeStyle = "#f3f4f6";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + plotWidth, y);
    ctx.stroke();

    // Label
    ctx.fillStyle = "#6b7280";
    let formatted = "";
    if (formatType === "pct") {
      formatted = (value * (Math.abs(value) <= 1 ? 100 : 1)).toFixed(1) + "%";
    } else if (formatType === "pos") {
      formatted = value.toFixed(1);
    } else {
      formatted = value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : value >= 1000 ? (value / 1000).toFixed(1) + "k" : Math.round(value).toLocaleString();
    }
    ctx.fillText(formatted, paddingLeft - 8 * dpr, y);
  }

  // X-axis Baseline
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(paddingLeft, paddingTop + plotHeight);
  ctx.lineTo(paddingLeft + plotWidth, paddingTop + plotHeight);
  ctx.stroke();

  // X-axis Labels (sample to avoid crowding)
  const pointCount = labels.length;
  const maxLabels = Math.min(10, pointCount);
  const labelStep = Math.max(1, Math.floor(pointCount / maxLabels));

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#6b7280";
  ctx.font = `${10 * dpr}px sans-serif`;

  for (let i = 0; i < pointCount; i += labelStep) {
    const x = paddingLeft + (pointCount > 1 ? (i / (pointCount - 1)) * plotWidth : plotWidth / 2);
    const label = String(labels[i] || "").replace(/^\d{4}-/, ""); // "11-05" from "2026-11-05"
    ctx.fillText(label, x, paddingTop + plotHeight + 6 * dpr);

    // Small tick
    ctx.strokeStyle = "#d1d5db";
    ctx.beginPath();
    ctx.moveTo(x, paddingTop + plotHeight);
    ctx.lineTo(x, paddingTop + plotHeight + 3 * dpr);
    ctx.stroke();
  }

  // Helper to map (index, val) -> (x, y)
  const getCoordinates = (idx, val) => {
    if (val === null || val === undefined || !Number.isFinite(Number(val))) return null;
    const x = paddingLeft + (pointCount > 1 ? (idx / (pointCount - 1)) * plotWidth : plotWidth / 2);
    const num = Number(val);
    let ratio = (num - minVal) / (maxVal - minVal);
    if (reversed) ratio = 1 - ratio;
    const y = paddingTop + plotHeight * (1 - ratio);
    return { x, y };
  };

  // Plot Each Series
  validSeries.forEach((s) => {
    const color = s.color || "#4285f4";
    const isDashed = Boolean(s.dashed);

    ctx.strokeStyle = color;
    ctx.lineWidth = (isDashed ? 2 : 2.5) * dpr;
    if (isDashed) {
      ctx.setLineDash([5 * dpr, 4 * dpr]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    let started = false;

    s.data.forEach((val, idx) => {
      const pt = getCoordinates(idx, val);
      if (!pt) {
        started = false;
        return;
      }
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Data dots
    if (pointCount <= 45) {
      ctx.fillStyle = color;
      s.data.forEach((val, idx) => {
        const pt = getCoordinates(idx, val);
        if (pt) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, (isDashed ? 2.5 : 3.5) * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  });

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

/**
 * Render a bar chart to Base64 PNG (for categorical data like acquisition channels)
 */
export function renderBarChartToPng({
  title = "Categorical Comparison",
  subtitle = "",
  categories = [],
  series = [],
  width = 900,
  height = 420
}) {
  const dpr = 2;
  const canvas = createCanvas(width * dpr, height * dpr);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width * dpr, height * dpr);

  // Border & card style
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(10 * dpr, 10 * dpr, (width - 20) * dpr, (height - 20) * dpr);

  // Title
  ctx.fillStyle = "#111827";
  ctx.font = `bold ${16 * dpr}px sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(title, 28 * dpr, 36 * dpr);

  if (subtitle) {
    ctx.fillStyle = "#6b7280";
    ctx.font = `${12 * dpr}px sans-serif`;
    ctx.fillText(subtitle, 28 * dpr, 54 * dpr);
  }

  const validSeries = series.filter((s) => Array.isArray(s.data) && s.data.length > 0);
  if (!categories.length || !validSeries.length) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = `${14 * dpr}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No categorical data available", (width / 2) * dpr, (height / 2) * dpr);
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  }

  const paddingLeft = 70 * dpr;
  const paddingRight = 35 * dpr;
  const paddingTop = 75 * dpr;
  const paddingBottom = 60 * dpr;

  const plotWidth = (width * dpr) - paddingLeft - paddingRight;
  const plotHeight = (height * dpr) - paddingTop - paddingBottom;

  // Max value calculation
  let maxVal = 0;
  validSeries.forEach((s) => {
    s.data.forEach((v) => {
      const num = Number(v) || 0;
      if (num > maxVal) maxVal = num;
    });
  });
  if (maxVal === 0) maxVal = 10;
  maxVal = maxVal * 1.15; // margin on top

  // Y-axis grid
  const steps = 4;
  ctx.font = `${10 * dpr}px sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const y = paddingTop + plotHeight * (1 - ratio);
    const val = ratio * maxVal;

    ctx.strokeStyle = "#f3f4f6";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + plotWidth, y);
    ctx.stroke();

    ctx.fillStyle = "#6b7280";
    ctx.fillText(Math.round(val).toLocaleString(), paddingLeft - 8 * dpr, y);
  }

  // Bars
  const catCount = categories.length;
  const groupWidth = plotWidth / catCount;
  const barWidth = Math.min(45 * dpr, (groupWidth * 0.7) / validSeries.length);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  categories.forEach((cat, catIdx) => {
    const groupCenterX = paddingLeft + (catIdx + 0.5) * groupWidth;

    validSeries.forEach((s, sIdx) => {
      const val = Number(s.data[catIdx]) || 0;
      const barHeight = (val / maxVal) * plotHeight;
      const barX = groupCenterX - (validSeries.length * barWidth) / 2 + sIdx * barWidth;
      const barY = paddingTop + plotHeight - barHeight;

      // Draw bar
      ctx.fillStyle = s.color || "#4285f4";
      ctx.fillRect(barX, barY, barWidth - 2 * dpr, barHeight);

      // Value label on bar
      if (val > 0) {
        ctx.fillStyle = "#374151";
        ctx.font = `${9 * dpr}px sans-serif`;
        ctx.fillText(val.toLocaleString(), barX + (barWidth - 2 * dpr) / 2, barY - 14 * dpr);
      }
    });

    // Category label (with ellipsis if long)
    ctx.fillStyle = "#4b5563";
    ctx.font = `${10 * dpr}px sans-serif`;
    const label = cat.length > 14 ? cat.slice(0, 12) + "…" : cat;
    ctx.fillText(label, groupCenterX, paddingTop + plotHeight + 8 * dpr);
  });

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

/**
 * Creates or enriches an Excel workbook with embedded visual graphs and summary cards
 */
export async function buildExcelReportWithCharts({
  existingBuffer = null,
  websiteName = "Website",
  source = "gsc",
  startDate = "",
  endDate = "",
  comparisonPeriod = null,
  summary = {},
  reportResult = null,
  filters = {}
}) {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = "SEO Analytics";
  wb.created = new Date();
  wb.modified = new Date();

  // If existing buffer from backend export is provided, load it to preserve exact sheets & tables
  if (existingBuffer) {
    try {
      await wb.xlsx.load(existingBuffer);
    } catch (e) {
      console.warn("Could not load backend XLSX buffer into ExcelJS, generating fresh workbook:", e);
    }
  }

  // Create or retrieve "Overview & Charts" as the primary first sheet
  let overviewSheet = wb.getWorksheet("Overview & Charts");
  if (!overviewSheet) {
    // Insert overview at the very beginning
    overviewSheet = wb.addWorksheet("Overview & Charts", { properties: { tabColor: { argb: "FF244062" } } });
  }

  // Ensure Overview & Charts is active/first if supported
  overviewSheet.columns = [
    { width: 4 },   // A: margin
    { width: 24 },  // B
    { width: 22 },  // C
    { width: 20 },  // D
    { width: 20 },  // E
    { width: 20 },  // F
    { width: 20 },  // G
    { width: 20 },  // H
  ];

  // Title & Metadata
  const titleRow = overviewSheet.addRow(["", `${source.toUpperCase().replaceAll("_", " ")} - Executive Overview & Visual Graphs`]);
  titleRow.font = { bold: true, size: 16, color: { argb: "FF1F2937" } };

  const siteRow = overviewSheet.addRow(["", `Website: ${websiteName}`]);
  siteRow.font = { size: 11, color: { argb: "FF4B5563" } };

  let periodText = `Reporting Period: ${startDate} to ${endDate}`;
  if (comparisonPeriod?.startDate && comparisonPeriod?.endDate) {
    periodText += ` (compared with ${comparisonPeriod.startDate} to ${comparisonPeriod.endDate})`;
  }
  const dateRow = overviewSheet.addRow(["", periodText]);
  dateRow.font = { size: 11, color: { argb: "FF4B5563" } };
  overviewSheet.addRow([]); // Blank spacer

  // KPI Summary Table if summary metrics exist
  const summaryEntries = Object.entries(summary || {});
  let chartStartRow = 6;

  if (summaryEntries.length > 0) {
    const kpiHeader = overviewSheet.addRow([
      "",
      "Metric",
      "Current Value",
      "Previous Value",
      "Change",
      "Change %"
    ]);
    kpiHeader.eachCell((cell, colNum) => {
      if (colNum > 1) {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF244062" } };
        cell.alignment = { vertical: "middle", horizontal: colNum === 2 ? "left" : "right" };
      }
    });

    summaryEntries.forEach(([key, val]) => {
      const cur = val?.currentValue ?? val;
      const prev = val?.previousValue ?? null;
      const abs = val?.absoluteChange ?? (prev !== null && cur !== null ? cur - prev : null);
      const pct = val?.percentageChange ?? null;

      const row = overviewSheet.addRow([
        "",
        METRIC_LABELS[key] || key.replaceAll("_", " "),
        formatValue(key, cur),
        prev !== null ? formatValue(key, prev) : "—",
        abs !== null ? formatValue(key, abs) : "—",
        pct !== null ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"
      ]);

      row.eachCell((cell, colNum) => {
        if (colNum > 1) {
          cell.alignment = { vertical: "middle", horizontal: colNum === 2 ? "left" : "right" };
          cell.border = {
            bottom: { style: "thin", color: { argb: "FFE5E7EB" } }
          };
          if (colNum === 6 && pct !== null) {
            cell.font = {
              color: { argb: pct > 0 ? "FF0B8043" : pct < 0 ? "FFD93025" : "FF374151" },
              bold: true
            };
          }
        }
      });
    });

    overviewSheet.addRow([]); // Spacer
    chartStartRow = overviewSheet.rowCount + 2;
  }

  // Generate & Embed Visual Charts
  const chartImages = [];

  // 1. COMBINED REPORT CHARTS
  if (source === "combined" && reportResult?.sections) {
    const { gsc, ga4, keyword_tracking } = reportResult.sections;

    // GSC Trend Chart
    if (gsc?.data?.current) {
      const dates = gsc.data.current.map((r) => r.date || r.report_date).filter(Boolean);
      const clicks = gsc.data.current.map((r) => toNum(r.clicks));
      const impressions = gsc.data.current.map((r) => toNum(r.impressions));

      const png = renderLineChartToPng({
        title: "Google Search Console - Clicks & Impressions Trend",
        subtitle: `${startDate} to ${endDate}`,
        labels: dates,
        series: [
          { name: "Clicks", color: METRIC_COLORS.clicks, data: clicks },
          { name: "Impressions", color: METRIC_COLORS.impressions, data: impressions }
        ],
        width: 880,
        height: 380
      });
      chartImages.push({ title: "GSC Performance", png });
    }

    // GA4 Trend Chart
    if (ga4?.data?.current) {
      const dates = ga4.data.current.map((r) => r.date || r.report_date).filter(Boolean);
      const sessions = ga4.data.current.map((r) => toNum(r.organic_sessions));
      const conversions = ga4.data.current.map((r) => toNum(r.total_form_conversions ?? r.form_submit_conversions));

      const png = renderLineChartToPng({
        title: "Google Analytics 4 - Organic Sessions & Form Conversions",
        subtitle: `${startDate} to ${endDate}`,
        labels: dates,
        series: [
          { name: "Organic Sessions", color: METRIC_COLORS.organic_sessions, data: sessions },
          { name: "Form Conversions", color: METRIC_COLORS.form_submit_conversions, data: conversions }
        ],
        width: 880,
        height: 380
      });
      chartImages.push({ title: "GA4 Traffic & Conversions", png });
    }

    // Keyword Tracking Summary Chart
    if (keyword_tracking?.data?.current) {
      const kwRows = keyword_tracking.data.current.slice(0, 15);
      const categories = kwRows.map((r) => r.keyword || `KW #${r.keywordId}`);
      const clicks = kwRows.map((r) => toNum(r.clicks));

      const png = renderBarChartToPng({
        title: "Top Tracked Keywords by Clicks",
        subtitle: `${startDate} to ${endDate}`,
        categories,
        series: [{ name: "Clicks", color: "#4285f4", data: clicks }],
        width: 880,
        height: 380
      });
      chartImages.push({ title: "Keyword Performance", png });
    }
  }

  // 2. COMPARISON REPORT CHARTS (Current vs Previous Period)
  else if (comparisonPeriod?.startDate && reportResult?.data?.current && reportResult?.data?.comparison) {
    const currentRows = reportResult.data.currentSeries ?? reportResult.data.current;
    const comparisonRows = reportResult.data.comparisonSeries ?? reportResult.data.comparison;

    // Build series for primary metrics
    const metricsToPlot = Object.keys(summary).filter((k) =>
      [...currentRows, ...comparisonRows].some((r) => Object.hasOwn(r, k))
    );

    metricsToPlot.slice(0, 3).forEach((metricKey) => {
      const chartSeries = buildReportChartSeries({
        currentRows,
        comparisonRows,
        currentPeriod: { startDate, endDate },
        comparisonPeriod,
        metric: metricKey,
        source
      });

      const dayLabels = chartSeries.data.map((r) => `Day ${r.day}`);
      const curData = chartSeries.data.map((r) => r.current);
      const prevData = chartSeries.data.map((r) => r.previous);

      const metricLabel = METRIC_LABELS[metricKey] || metricKey.replaceAll("_", " ");
      const isReversed = metricKey.toLowerCase().includes("position");
      const formatType = isReversed ? "pos" : /ctr|rate/i.test(metricKey) ? "pct" : "int";

      const png = renderLineChartToPng({
        title: `${metricLabel} - Current vs Comparison Period`,
        subtitle: `${startDate} to ${endDate} vs ${comparisonPeriod.startDate} to ${comparisonPeriod.endDate}`,
        labels: dayLabels,
        series: [
          { name: `Current (${startDate} - ${endDate})`, color: METRIC_COLORS[metricKey] || "#4285f4", data: curData },
          { name: `Comparison (${comparisonPeriod.startDate} - ${comparisonPeriod.endDate})`, color: "#9aa0a6", dashed: true, data: prevData }
        ],
        reversed: isReversed,
        formatType,
        width: 880,
        height: 380
      });

      chartImages.push({ title: `${metricLabel} Comparison`, png });
    });
  }

  // 3. STANDARD DATE-BASED REPORTS (GSC, GA4, Keyword Tracking, Acquisition)
  else if (reportResult?.data?.current || Array.isArray(reportResult)) {
    const rows = Array.isArray(reportResult) ? reportResult : (reportResult.data?.current ?? []);

    if (source === "gsc") {
      const dates = rows.map((r) => r.date || r.report_date).filter(Boolean);
      const clicks = rows.map((r) => toNum(r.clicks));
      const impressions = rows.map((r) => toNum(r.impressions));
      const positions = rows.map((r) => toNum(r.average_position));

      // Clicks & Impressions
      const png1 = renderLineChartToPng({
        title: "Search Console - Clicks & Impressions",
        subtitle: `${startDate} to ${endDate}`,
        labels: dates,
        series: [
          { name: "Clicks", color: METRIC_COLORS.clicks, data: clicks },
          { name: "Impressions", color: METRIC_COLORS.impressions, data: impressions }
        ],
        width: 880,
        height: 380
      });
      chartImages.push({ title: "Traffic Trend", png: png1 });

      // Average Position
      const png2 = renderLineChartToPng({
        title: "Search Console - Average Position (Lower is better)",
        subtitle: `${startDate} to ${endDate}`,
        labels: dates,
        series: [{ name: "Average Position", color: METRIC_COLORS.average_position, data: positions }],
        reversed: true,
        formatType: "pos",
        width: 880,
        height: 340
      });
      chartImages.push({ title: "Position Trend", png: png2 });
    } else if (source === "ga4") {
      const dates = rows.map((r) => r.date || r.report_date).filter(Boolean);
      const sessions = rows.map((r) => toNum(r.organic_sessions));
      const forms = rows.map((r) => toNum(r.total_form_conversions ?? r.form_submit_conversions));

      const png = renderLineChartToPng({
        title: "Google Analytics 4 - Organic Sessions & Form Submissions",
        subtitle: `${startDate} to ${endDate}`,
        labels: dates,
        series: [
          { name: "Organic Sessions", color: METRIC_COLORS.organic_sessions, data: sessions },
          { name: "Form Submissions", color: METRIC_COLORS.form_submit_conversions, data: forms }
        ],
        width: 880,
        height: 380
      });
      chartImages.push({ title: "GA4 Trend", png });
    } else if (source === "traffic_acquisition" || source === "user_acquisition") {
      // Categorical bar chart by channel or source/medium
      const categories = rows.map((r) => r.dimensionValue || r.name || r.channel_group || "Unknown");
      const sessions = rows.map((r) => toNum(r.sessions ?? r.totalUsers));

      const png = renderBarChartToPng({
        title: `${source === "traffic_acquisition" ? "Traffic" : "User"} Acquisition by ${filters?.dimensionType === "source_medium" ? "Source / Medium" : "Channel Group"}`,
        subtitle: `${startDate} to ${endDate}`,
        categories: categories.slice(0, 12),
        series: [{ name: source === "traffic_acquisition" ? "Sessions" : "Users", color: "#4285f4", data: sessions.slice(0, 12) }],
        width: 880,
        height: 380
      });
      chartImages.push({ title: "Acquisition Breakdown", png });
    } else if (source === "keyword_tracking") {
      const dates = rows.map((r) => r.date || r.report_date).filter(Boolean);
      const positions = rows.map((r) => toNum(r.average_position));
      const clicks = rows.map((r) => toNum(r.clicks));

      const kwTitle = filters?.keyword ? `Keyword: “${filters.keyword}”` : "Keyword Ranking";

      const png1 = renderLineChartToPng({
        title: `${kwTitle} - Ranking Position Over Time`,
        subtitle: `${startDate} to ${endDate} (Position 1 is top of page)`,
        labels: dates,
        series: [{ name: "Ranking Position", color: METRIC_COLORS.average_position, data: positions }],
        reversed: true,
        formatType: "pos",
        width: 880,
        height: 350
      });
      chartImages.push({ title: "Keyword Ranking", png: png1 });

      const png2 = renderLineChartToPng({
        title: `${kwTitle} - Daily Clicks`,
        subtitle: `${startDate} to ${endDate}`,
        labels: dates,
        series: [{ name: "Clicks", color: METRIC_COLORS.clicks, data: clicks }],
        width: 880,
        height: 320
      });
      chartImages.push({ title: "Keyword Clicks", png: png2 });
    }
  }

  // 4. LANDING PAGE REPORT
  if (source === "landing_pages" || source === "visitor_entry") {
    // Graceful handling of known limitation
    overviewSheet.addRow(["", "Note: Visitor entry (landing pages) data is currently not persisted in the database."]);
  }

  // Embed the rendered charts into the Overview & Charts sheet
  let currentTopRow = chartStartRow;
  for (const item of chartImages) {
    if (!item.png) continue;

    const imageId = wb.addImage({
      base64: item.png,
      extension: "png"
    });

    overviewSheet.addImage(imageId, {
      tl: { col: 1, row: currentTopRow },
      ext: { width: 780, height: 350 }
    });

    // Advance 19 rows per chart
    currentTopRow += 19;
  }

  // Also add the primary chart to the relevant data sheet if it exists
  const targetSheetName = source === "combined" ? "GSC" : "Report";
  const dataSheet = wb.getWorksheet(targetSheetName);
  if (dataSheet && chartImages.length > 0 && chartImages[0].png) {
    const primaryImageId = wb.addImage({
      base64: chartImages[0].png,
      extension: "png"
    });
    // Place chart to the right of the table (column H, row 4)
    dataSheet.addImage(primaryImageId, {
      tl: { col: 8, row: 3 },
      ext: { width: 720, height: 320 }
    });
  }

  return wb.xlsx.writeBuffer();
}

/**
 * Downloads an Excel report enriched with embedded visual charts
 */
export async function exportExcelReport({
  websiteId,
  websiteName = "Website",
  source = "gsc",
  startDate,
  endDate,
  comparisonPeriod = null,
  comparisonMode = "previous_period",
  filters = {},
  metrics = [],
  reportResult = null
}) {
  const queryParams = {
    source,
    startDate,
    endDate,
    format: "xlsx"
  };
  if (metrics && metrics.length && source !== "combined") {
    queryParams.metrics = Array.isArray(metrics) ? metrics.join(",") : String(metrics);
  }
  const filterStr = typeof filters === "object" && Object.keys(filters).length ? JSON.stringify(filters) : undefined;
  if (filterStr) {
    queryParams.filters = filterStr;
  }

  // Fetch backend XLSX export (handles auth, permission validation, activity log, tables)
  const { buffer, filename } = await fetchReportExport(websiteId, queryParams);

  // If reportResult not passed, attempt to fetch comparison result for visual series
  let result = reportResult;
  if (!result) {
    try {
      if (source === "combined") {
        const [gsc, ga4, keywordTracking] = await Promise.all(
          ["gsc", "ga4", "keyword_tracking"].map((s) =>
            getReportComparison(websiteId, { source: s, currentStartDate: startDate, currentEndDate: endDate, comparisonMode })
          )
        );
        result = { source: "combined", sections: { gsc, ga4, keyword_tracking: keywordTracking } };
      } else {
        const compParams = {
          source,
          currentStartDate: startDate,
          currentEndDate: endDate
        };
        if (comparisonPeriod?.startDate && comparisonPeriod?.endDate) {
          compParams.compareStartDate = comparisonPeriod.startDate;
          compParams.compareEndDate = comparisonPeriod.endDate;
        } else {
          compParams.comparisonMode = comparisonMode;
        }
        if (metrics && metrics.length) compParams.metrics = Array.isArray(metrics) ? metrics.join(",") : String(metrics);
        if (filterStr) compParams.filters = filterStr;
        result = await getReportComparison(websiteId, compParams);
      }
    } catch (e) {
      console.warn("Could not fetch comparison data for charts, generating charts from basic export:", e);
    }
  }

  // Enrich the workbook with actual visual graphs
  const enrichedBuffer = await buildExcelReportWithCharts({
    existingBuffer: buffer,
    websiteName,
    source,
    startDate,
    endDate,
    comparisonPeriod: result?.periods?.comparison ?? comparisonPeriod,
    summary: result?.summary ?? {},
    reportResult: result,
    filters: typeof filters === "object" ? filters : {}
  });

  // Trigger browser download
  triggerBlobDownload(
    enrichedBuffer,
    filename || `${source}-report-${startDate}-to-${endDate}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}
