import { acquisitionReportService } from "./acquisition-report.service.js";
import { ga4ReportService } from "./ga4-report.service.js";
import { gscReportService } from "./gsc-report.service.js";
import { reportsRepository } from "../repositories/reports.repository.js";

export function createReportsService({
  repository = reportsRepository,
  gsc = gscReportService,
  ga4 = ga4ReportService,
  acquisition = acquisitionReportService
} = {}) {
  async function getOverview({ website, userId, startDate, endDate }) {
    const websiteId = website.website_id;
    const [gscRows, ga4Rows, defaultChannelGroup, sourceMedium, userAcquisition, sync] =
      await Promise.all([
        gsc.getDailyPerformance({ websiteId, startDate, endDate }),
        ga4.getDailySummary({ websiteId, startDate, endDate }),
        acquisition.getTrafficAcquisition({
          userId,
          websiteId,
          startDate,
          endDate,
          dimensionType: "default_channel_group"
        }),
        acquisition.getTrafficAcquisition({
          userId,
          websiteId,
          startDate,
          endDate,
          dimensionType: "source_medium"
        }),
        ga4.getStoredUserAcquisition({ userId, websiteId, startDate, endDate }),
        repository.getSyncMetadata(websiteId)
      ]);

    return {
      website: {
        websiteId,
        websiteName: website.website_name,
        domainName: website.domain_name,
        ga4PropertyId: website.ga4_property_id,
        gscPropertyUrl: website.gsc_property_url
      },
      dateRange: { startDate, endDate },
      data: {
        googleSearchConsole: gscRows,
        googleAnalytics: ga4Rows,
        trafficAcquisition: { defaultChannelGroup, sourceMedium },
        userAcquisition
      },
      sync
    };
  }

  return {
    getOverview,
    getGscDailyPerformance: gsc.getDailyPerformance,
    getGa4DailySummary: ga4.getDailySummary,
    getUserAcquisition: ga4.getUserAcquisition,
    getTrafficAcquisition: acquisition.getTrafficAcquisition,
    getTrafficAcquisitionDaily: repository.getTrafficAcquisitionDaily,
    requestTrafficSync: acquisition.requestTrafficSync
  };
}

export const reportsService = createReportsService();
