import { initSurveyScheduler } from "../api/survey/survery.controller";
import { initNoticePeriodSchedular } from "../api/resignation/resignation.controller";
import { initLeaveEndSchedular } from "../api/leave/leave.controller";
import { initQuarterlyAppraisalScheduler } from "../api/appraisal/appraisal.controller";

export function startSchedulers() {
  initSurveyScheduler();
  initNoticePeriodSchedular();
  initLeaveEndSchedular();
  initQuarterlyAppraisalScheduler();
}
