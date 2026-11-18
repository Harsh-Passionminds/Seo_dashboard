import { reportsRepository } from "../repositories/reports.repository.js";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createKeywordReportService(repository = reportsRepository) {
  return {
    async list({ websiteId, startDate, endDate, search, sort, order, page, limit }) {
      const { rows, total } = await repository.getUnifiedKeywordReport({
        websiteId,
        startDate,
        endDate,
        search,
        sort,
        order,
        limit,
        offset: (page - 1) * limit
      });

      return {
        rows: rows.map((row) => {
          const averagePosition = numberOrNull(row.average_position);
          const previousAveragePosition = numberOrNull(row.previous_average_position);
          const positionChange = averagePosition === null || previousAveragePosition === null
            ? null
            : averagePosition - previousAveragePosition;
          return {
            keywordId: Number(row.keyword_id),
            websiteId: Number(row.website_id),
            keyword: row.keyword,
            clicks: numberOrNull(row.clicks),
            impressions: numberOrNull(row.impressions),
            ctr: numberOrNull(row.ctr),
            averagePosition,
            previousAveragePosition,
            positionChange,
            positionTrend: positionChange === null
              ? "unavailable"
              : positionChange < 0
                ? "improved"
                : positionChange > 0
                  ? "declined"
                  : "unchanged",
            lastUpdated: row.last_observation_date
              ? String(row.last_observation_date).slice(0, 10)
              : null,
            trackingStatus: row.tracking_status
          };
        }),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        dateRange: { startDate, endDate }
      };
    }
  };
}

export const keywordReportService = createKeywordReportService();
