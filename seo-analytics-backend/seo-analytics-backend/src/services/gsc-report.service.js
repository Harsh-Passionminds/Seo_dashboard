import { reportsRepository } from "../repositories/reports.repository.js";

export function createGscReportService(repository = reportsRepository) {
  return {
    getDailyPerformance({ websiteId, startDate, endDate }) {
      return repository.getGscDaily(websiteId, startDate, endDate);
    }
  };
}

export const gscReportService = createGscReportService();
