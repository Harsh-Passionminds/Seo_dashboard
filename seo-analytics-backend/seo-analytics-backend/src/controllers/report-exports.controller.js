import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { comparisonReportService } from "../services/comparison-report.service.js";
import { reportExportService } from "../services/report-export.service.js";
import { parseComparisonQuery, parseExportQuery } from "../validators/report-exports.validator.js";

export function createReportExportsController({
  comparisonService = comparisonReportService,
  exportService = reportExportService
} = {}) {
  async function compare(req, res, next) {
    try {
      const options = parseComparisonQuery(req.query);
      const result = await comparisonService.compare({
        ...options,
        website: req.website,
        userId: req.user.user_id,
        timeZone: req.organization.default_timezone
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async function exportReport(req, res, next) {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    req.once("aborted", abort);
    res.once("close", () => {
      if (!res.writableEnded) abort();
    });

    let output;
    try {
      const options = parseExportQuery(req.query);
      output = await exportService.generate({
        ...options,
        website: req.website,
        userId: req.user.user_id,
        organizationId: req.organization.organization_id,
        signal: abortController.signal
      });
      const fileInfo = await stat(output.filePath);
      res.status(200);
      res.set({
        "Content-Type": output.contentType,
        "Content-Disposition": `attachment; filename="${output.filename}"`,
        "Content-Length": String(fileInfo.size),
        "Cache-Control": "no-store"
      });
      await pipeline(createReadStream(output.filePath), res);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) next(error);
      else if (!res.destroyed) res.destroy(error);
    } finally {
      req.off("aborted", abort);
      if (output) {
        try {
          await exportService.cleanup(output);
        } catch (error) {
          console.error("Could not clean up report export file:", error.message);
        }
      }
    }
  }

  return { compare, exportReport };
}

export const reportExportsController = createReportExportsController();
