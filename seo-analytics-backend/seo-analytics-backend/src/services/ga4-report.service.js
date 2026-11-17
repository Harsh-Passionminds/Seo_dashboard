import { reportsRepository } from "../repositories/reports.repository.js";
import { getGa4Acquisition } from "./ga4.service.js";

export function createGa4ReportService({
  repository = reportsRepository,
  getAcquisition = getGa4Acquisition
} = {}) {
  return {
    getDailySummary({ websiteId, startDate, endDate }) {
      return repository.getGa4Summary(websiteId, startDate, endDate);
    },

    getStoredUserAcquisition({ userId, websiteId, startDate, endDate }) {
      return repository.getUserAcquisition(userId, websiteId, startDate, endDate);
    },

    getUserAcquisition({
      userId,
      websiteId,
      startDate,
      endDate,
      reportType,
      dimensionType,
      dimensionValue,
      rowLimit
    }) {
      return getAcquisition({
        userId,
        websiteId,
        startDate,
        endDate,
        reportType,
        dimensionType,
        dimensionValue,
        rowLimit
      });
    }
  };
}

export const ga4ReportService = createGa4ReportService();
