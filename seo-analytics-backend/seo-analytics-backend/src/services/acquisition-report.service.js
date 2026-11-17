import { getGa4Acquisition, getTrafficAcquisitionReport } from "./ga4.service.js";
import { requestTrafficAcquisitionSync } from "./sync.service.js";

export function createAcquisitionReportService({
  getUserAcquisition = getGa4Acquisition,
  getTrafficAcquisition = getTrafficAcquisitionReport,
  requestTrafficSync = requestTrafficAcquisitionSync
} = {}) {
  return {
    getUserAcquisition,
    getTrafficAcquisition,
    requestTrafficSync
  };
}

export const acquisitionReportService = createAcquisitionReportService();
