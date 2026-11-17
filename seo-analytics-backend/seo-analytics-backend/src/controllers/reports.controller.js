import {
  addTrackedKeyword,
  deleteTrackedKeyword,
  getKeywordHistory,
  listTrackedKeywords,
  syncGscKeywordsRange
} from "../services/gsc-keywords.service.js";
import { reportsService } from "../services/reports.service.js";
import { parseGa4ReportQuery, parseKeywordBody, parseKeywordId, parseReportDateRange } from "../validators/reports.validator.js";

function handler(operation) {
  return async (req, res, next) => {
    try {
      await operation(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export function createReportsController({
  service = reportsService,
  keywords = {
    add: addTrackedKeyword,
    remove: deleteTrackedKeyword,
    history: getKeywordHistory,
    list: listTrackedKeywords,
    sync: syncGscKeywordsRange
  }
} = {}) {
  return {
    getOverview: handler(async (req, res) => {
      const { startDate, endDate } = parseReportDateRange(req.query);
      const report = await service.getOverview({
        website: req.website,
        userId: req.website.owner_user_id,
        startDate,
        endDate
      });
      res.json(report);
    }),

    getGsc: handler(async (req, res) => {
      const { startDate, endDate } = parseReportDateRange(req.query);
      const rows = await service.getGscDailyPerformance({
        websiteId: req.website.website_id,
        startDate,
        endDate
      });
      res.json({
        websiteId: req.website.website_id,
        dateRange: { startDate, endDate },
        rows
      });
    }),

    listKeywords: handler(async (req, res) => {
      const keywordsList = await keywords.list(req.website.website_id);
      res.json({
        websiteId: req.website.website_id,
        keywords: keywordsList,
        count: keywordsList.length
      });
    }),

    addKeyword: handler(async (req, res) => {
      const keyword = parseKeywordBody(req.body);
      const saved = await keywords.add(req.website.website_id, keyword);
      res.status(201).json({ websiteId: req.website.website_id, keyword: saved });
    }),

    deleteKeyword: handler(async (req, res) => {
      const keywordId = parseKeywordId(req.params.keywordId);
      await keywords.remove(req.website.website_id, keywordId);
      res.json({ websiteId: req.website.website_id, keywordId, deleted: true });
    }),

    getKeywordHistory: handler(async (req, res) => {
      const keywordId = parseKeywordId(req.params.keywordId);
      const { startDate, endDate } = parseReportDateRange(req.query);
      const rows = await keywords.history(
        req.website.website_id,
        keywordId,
        startDate,
        endDate
      );
      res.json({
        websiteId: req.website.website_id,
        keywordId,
        dateRange: { startDate, endDate },
        rows
      });
    }),

    syncKeywordHistory: handler(async (req, res) => {
      const keywordId = parseKeywordId(req.params.keywordId);
      const { startDate, endDate } = parseReportDateRange(req.body);
      const result = await keywords.sync({
        userId: req.user.user_id,
        website: req.website,
        startDate,
        endDate,
        keywordId
      });
      res.status(202).json({
        websiteId: req.website.website_id,
        keywordId,
        dateRange: { startDate, endDate },
        ...result
      });
    }),

    getGa4: handler(async (req, res) => {
      const { startDate, endDate } = parseReportDateRange(req.query);
      const { reportType, dimensionType } = parseGa4ReportQuery(req.query);
      const websiteId = req.website.website_id;

      if (reportType === "traffic_acquisition") {
        const report = await service.getTrafficAcquisition({
          userId: req.website.owner_user_id,
          websiteId,
          startDate,
          endDate,
          dimensionType
        });
        return res.json({
          websiteId,
          reportType,
          dimensionType,
          dateRange: { startDate, endDate },
          count: report.rows.length,
          rows: report.rows,
          total: report.total
        });
      }

      if (reportType === "user_acquisition") {
        const rows = await service.getUserAcquisition({
          userId: req.website.owner_user_id,
          websiteId,
          startDate,
          endDate,
          reportType,
          dimensionType
        });
        return res.json({
          websiteId,
          reportType,
          dimensionType,
          dateRange: { startDate, endDate },
          count: rows.length,
          rows
        });
      }

      const rows = await service.getGa4DailySummary({
        websiteId,
        startDate,
        endDate
      });
      return res.json({
        websiteId,
        reportType,
        dateRange: { startDate, endDate },
        rows
      });
    }),

    syncTrafficAcquisition: handler(async (req, res) => {
      const { startDate, endDate } = parseReportDateRange(req.body);
      const job = await service.requestTrafficSync(req.website, { startDate, endDate });
      res.status(202).json({
        websiteId: req.website.website_id,
        source: "ga4",
        reportType: "traffic_acquisition",
        dateRange: { startDate, endDate },
        ...job
      });
    })
  };
}

export const reportsController = createReportsController();
