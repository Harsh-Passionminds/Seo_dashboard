import ExcelJS from "exceljs";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, rmdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { reportDataService } from "./report-data.service.js";
import { reportsRepository } from "../repositories/reports.repository.js";
import { HttpError } from "../utils/http-error.js";

const MIME_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};
const METRIC_HEADERS = {
  clicks: "Clicks",
  impressions: "Impressions",
  ctr: "Click-through rate",
  average_position: "Average position",
  organic_sessions: "Organic sessions",
  form_submit_conversions: "Form submit conversions",
  from_submit_conversions: "From submit conversions",
  total_form_conversions: "Total form conversions",
  sessions: "Sessions",
  engagedSessions: "Engaged sessions",
  engagementRate: "Engagement rate",
  totalUsers: "Total users",
  newUsers: "New users",
  activeUsers: "Active users",
  averageSessionDuration: "Average session duration",
  conversions: "Conversions",
  totalRevenue: "Total revenue",
  previousAveragePosition: "Previous average position",
  positionChange: "Position change"
};
const DIMENSION_HEADERS = {
  section: "Section",
  date: "Date",
  dimensionValue: "Dimension value",
  dimensionType: "Dimension type",
  keywordId: "Keyword ID",
  keyword: "Keyword",
  lastUpdated: "Last updated",
  trackingStatus: "Tracking status"
};
const NUMBER_FORMATS = new Map([
  ["ctr", "0.00%"],
  ["engagementRate", "0.00%"],
  ["average_position", "0.000"],
  ["averageSessionDuration", "0.00"],
  ["totalRevenue", "#,##0.00"]
]);

function metricValue(row, metric) {
  const value = row.metrics?.[metric] ?? row[metric];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dimensionValue(row, dimension) {
  if (dimension === "date") return row.report_date ?? null;
  if (dimension === "dimensionValue") return row.dimensionValue ?? null;
  if (dimension === "dimensionType") return row.dimensionType ?? null;
  if (dimension === "keywordId") return row.keyword_id ?? null;
  if (dimension === "keyword") return row.keyword ?? null;
  if (dimension === "section") return row.section ?? null;
  if (dimension === "lastUpdated") return row.lastUpdated ?? row.last_observation_date ?? null;
  if (dimension === "trackingStatus") return row.trackingStatus ?? row.tracking_status ?? null;
  return null;
}

function safeFilenamePart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "report";
}

export function createReportFilename({ websiteName, source, startDate, endDate, format }) {
  return `${safeFilenamePart(websiteName)}-${safeFilenamePart(source)}-${startDate}-to-${endDate}.${format}`;
}

export function escapeCsvValue(value, { text: untrustedText = typeof value === "string" } = {}) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (untrustedText && /^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function formatCellValue(value, column) {
  if (value === null || value === undefined) return null;
  if (column === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  if (METRIC_HEADERS[column]) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return String(value);
}

function getColumns(options) {
  return [
    ...options.dimensions.map((key) => ({ key, header: DIMENSION_HEADERS[key] })),
    ...options.metrics.map((key) => ({ key, header: METRIC_HEADERS[key] }))
  ];
}

function checkDisconnected(signal) {
  if (signal?.aborted) {
    throw new HttpError(499, "The client disconnected while the export was being generated.", "CLIENT_DISCONNECTED");
  }
}

async function writeCsv(filePath, rows, columns, signal) {
  async function* content() {
    yield "\uFEFF";
    yield `${columns.map((column) => escapeCsvValue(column.header)).join(",")}\r\n`;
    for (let index = 0; index < rows.length; index += 1) {
      if (index % 500 === 0) checkDisconnected(signal);
      const row = rows[index];
      const values = columns.map(({ key }) =>
        key in DIMENSION_HEADERS
          ? dimensionValue(row, key)
          : metricValue(row, key)
      );
      yield `${values.map((value) => escapeCsvValue(value, { text: typeof value === "string" })).join(",")}\r\n`;
    }
  }
  await pipeline(Readable.from(content()), createWriteStream(filePath));
}

async function writeXlsx(filePath, {
  rows,
  columns,
  source,
  websiteName,
  startDate,
  endDate,
  worksheets,
  signal
}) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
    useSharedStrings: false
  });
  workbook.creator = "SEO Analytics";
  workbook.created = new Date();
  workbook.modified = new Date();
  const sheets = worksheets ?? [{ name: "Report", source, rows, columns }];
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = sheet.columns.map(({ key }) => ({ key, width: 22 }));
    worksheet.addRow([`${sheet.source.toUpperCase()} report`]).commit();
    worksheet.addRow([`Website: ${websiteName}`]).commit();
    worksheet.addRow([`Reporting period: ${startDate} to ${endDate}`]).commit();
    const headerRow = worksheet.addRow(sheet.columns.map((column) => column.header));
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF244062" } };
    });
    headerRow.commit();

    for (let index = 0; index < sheet.rows.length; index += 1) {
      if (index % 500 === 0) checkDisconnected(signal);
      const row = sheet.rows[index];
      const output = sheet.columns.map(({ key }) =>
        key in DIMENSION_HEADERS
          ? formatCellValue(dimensionValue(row, key), key)
          : formatCellValue(metricValue(row, key), key)
      );
      const excelRow = worksheet.addRow(output);
      sheet.columns.forEach((column, columnIndex) => {
        const cell = excelRow.getCell(columnIndex + 1);
        if (column.key === "date" || column.key === "lastUpdated") cell.numFmt = "yyyy-mm-dd";
        else if (NUMBER_FORMATS.has(column.key)) cell.numFmt = NUMBER_FORMATS.get(column.key);
      });
      excelRow.commit();
    }
    worksheet.commit();
  }

  await workbook.commit();
}

async function ensureValidXlsx(filePath) {
  const fileInfo = await stat(filePath);
  const handle = await open(filePath, "r");
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (fileInfo.size < 4 || bytesRead !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b) {
      throw new HttpError(500, "XLSX workbook generation produced an invalid file.", "XLSX_GENERATION_FAILED");
    }
  } finally {
    await handle.close();
  }
}

async function removeTemporaryFiles(directory, filePath) {
  if (filePath) {
    try {
      await rm(filePath, { force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (directory) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
    }
  }
}

export function createReportExportService({
  dataService = reportDataService,
  repository = reportsRepository
} = {}) {
  async function generate({
    website,
    userId,
    organizationId,
    source,
    startDate,
    endDate,
    metrics,
    dimensions,
    filters,
    sortBy,
    order,
    format = "csv",
    signal
  }) {
    let directory;
    let filePath;
    try {
      checkDisconnected(signal);
      let rows;
      let worksheets;
      let columns = getColumns({ metrics, dimensions });
      if (source === "combined") {
        const [gscRows, ga4Rows, keywordRows] = await Promise.all([
          dataService.getSourceRows({ source: "gsc", userId, website, startDate, endDate, filters: {}, sortBy: "date", order: "asc" }),
          dataService.getSourceRows({ source: "ga4", userId, website, startDate, endDate, filters: {}, sortBy: "date", order: "asc" }),
          dataService.getUnifiedKeywordRows({ websiteId: website.website_id, startDate, endDate })
        ]);
        const keywordReportRows = keywordRows.map((row) => ({
          ...row,
          keywordId: Number(row.keyword_id),
          lastUpdated: row.last_observation_date
            ? String(row.last_observation_date).slice(0, 10)
            : null,
          trackingStatus: row.tracking_status,
          previousAveragePosition: row.previous_average_position === null
            ? null
            : Number(row.previous_average_position),
          positionChange: row.average_position === null || row.previous_average_position === null
            ? null
            : Number(row.average_position) - Number(row.previous_average_position)
        }));
        const sheetColumns = {
          gsc: getColumns({ dimensions: ["date"], metrics: ["clicks", "impressions", "ctr", "average_position"] }),
          ga4: getColumns({
            dimensions: ["date"],
            metrics: ["organic_sessions", "form_submit_conversions", "from_submit_conversions", "total_form_conversions"]
          }),
          keyword_tracking: getColumns({
            dimensions: ["keywordId", "keyword", "lastUpdated", "trackingStatus"],
            metrics: ["clicks", "impressions", "ctr", "average_position", "previousAveragePosition", "positionChange"]
          })
        };
        worksheets = [
          { name: "GSC", source: "gsc", rows: gscRows, columns: sheetColumns.gsc },
          { name: "GA4", source: "ga4", rows: ga4Rows, columns: sheetColumns.ga4 },
          { name: "Keywords", source: "keyword_tracking", rows: keywordReportRows, columns: sheetColumns.keyword_tracking }
        ];
        rows = [...gscRows, ...ga4Rows, ...keywordReportRows];
        if (format === "csv") {
          const combinedColumns = [
            { key: "section", header: "Section" },
            { key: "date", header: "Date" },
            { key: "keywordId", header: "Keyword ID" },
            { key: "keyword", header: "Keyword" },
            { key: "lastUpdated", header: "Last updated" },
            { key: "trackingStatus", header: "Tracking status" },
            ...getColumns({
              dimensions: [],
              metrics: [
                "clicks", "impressions", "ctr", "average_position",
                "previousAveragePosition", "positionChange", "organic_sessions",
                "form_submit_conversions", "from_submit_conversions", "total_form_conversions"
              ]
            })
          ];
          rows = [
            ...gscRows.map((row) => ({ ...row, section: "GSC" })),
            ...ga4Rows.map((row) => ({ ...row, section: "GA4" })),
            ...keywordReportRows.map((row) => ({ ...row, section: "Keyword Tracking" }))
          ];
          columns = combinedColumns;
        }
      } else {
        rows = await dataService.getSourceRows({
          source,
          userId,
          website,
          startDate,
          endDate,
          filters,
          sortBy,
          order
        });
      }
      checkDisconnected(signal);
      directory = await mkdtemp(path.join(os.tmpdir(), "seo-report-"));
      filePath = path.join(directory, `report.${format}`);
      if (format === "csv") {
        await writeCsv(filePath, rows, columns, signal);
      } else {
        await writeXlsx(filePath, {
          rows,
          columns,
          source,
          websiteName: website.website_name,
          startDate,
          endDate,
          worksheets,
          signal
        });
        await ensureValidXlsx(filePath);
      }
      checkDisconnected(signal);
      await repository.recordReportExport({
        organizationId,
        userId,
        websiteId: website.website_id,
        source,
        format,
        startDate,
        endDate,
        metrics,
        dimensions,
        filters
      });
      return {
        filePath,
        directory,
        filename: createReportFilename({
          websiteName: website.website_name,
          source,
          startDate,
          endDate,
          format
        }),
        contentType: MIME_TYPES[format],
        rowCount: rows.length
      };
    } catch (error) {
      await removeTemporaryFiles(directory, filePath);
      throw error;
    }
  }

  return {
    generate,
    async cleanup(output) {
      await removeTemporaryFiles(output.directory, output.filePath);
    }
  };
}

export const reportExportService = createReportExportService();
