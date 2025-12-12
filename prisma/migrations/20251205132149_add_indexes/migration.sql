-- CreateIndex
CREATE INDEX `Application_status_idx` ON `Application`(`status`);

-- CreateIndex
CREATE INDEX `Application_jobId_idx` ON `Application`(`jobId`);

-- CreateIndex
CREATE INDEX `Attendance_employeeId_date_idx` ON `Attendance`(`employeeId`, `date`);

-- CreateIndex
CREATE INDEX `Attendance_status_idx` ON `Attendance`(`status`);

-- CreateIndex
CREATE INDEX `Candidate_email_idx` ON `Candidate`(`email`);

-- CreateIndex
CREATE INDEX `Employee_employmentStatus_idx` ON `Employee`(`employmentStatus`);

-- CreateIndex
CREATE INDEX `Employee_firstName_idx` ON `Employee`(`firstName`);

-- CreateIndex
CREATE INDEX `Employee_lastName_idx` ON `Employee`(`lastName`);

-- CreateIndex
CREATE INDEX `Employee_reportingManager_idx` ON `Employee`(`reportingManager`);

-- CreateIndex
CREATE INDEX `Grievance_status_idx` ON `Grievance`(`status`);

-- CreateIndex
CREATE INDEX `Interview_stage_idx` ON `Interview`(`stage`);

-- CreateIndex
CREATE INDEX `InterviewFeedback_status_idx` ON `InterviewFeedback`(`status`);

-- CreateIndex
CREATE INDEX `InterviewHRReview_reviewerUserId_idx` ON `InterviewHRReview`(`reviewerUserId`);

-- CreateIndex
CREATE INDEX `Job_title_idx` ON `Job`(`title`);

-- CreateIndex
CREATE INDEX `LeaveRequest_startDate_idx` ON `LeaveRequest`(`startDate`);

-- CreateIndex
CREATE INDEX `LeaveRequest_endDate_idx` ON `LeaveRequest`(`endDate`);

-- CreateIndex
CREATE INDEX `LeaveRequest_status_idx` ON `LeaveRequest`(`status`);

-- CreateIndex
CREATE INDEX `PerformanceResponse_cycle_idx` ON `PerformanceResponse`(`cycle`);

-- CreateIndex
CREATE INDEX `PerformanceSummary_employeeId_cycle_idx` ON `PerformanceSummary`(`employeeId`, `cycle`);

-- CreateIndex
CREATE INDEX `PoshCase_status_idx` ON `PoshCase`(`status`);

-- CreateIndex
CREATE INDEX `ShiftAssignment_employeeId_date_idx` ON `ShiftAssignment`(`employeeId`, `date`);

-- CreateIndex
CREATE INDEX `Training_status_idx` ON `Training`(`status`);

-- CreateIndex
CREATE INDEX `TrainingAssignment_status_idx` ON `TrainingAssignment`(`status`);

-- RenameIndex
ALTER TABLE `AssignedTest` RENAME INDEX `AssignedTest_employeeId_fkey` TO `AssignedTest_employeeId_idx`;

-- RenameIndex
ALTER TABLE `Employee` RENAME INDEX `Employee_branchId_fkey` TO `Employee_branchId_idx`;

-- RenameIndex
ALTER TABLE `Employee` RENAME INDEX `Employee_departmentId_fkey` TO `Employee_departmentId_idx`;

-- RenameIndex
ALTER TABLE `Employee` RENAME INDEX `Employee_roleId_fkey` TO `Employee_roleId_idx`;

-- RenameIndex
ALTER TABLE `Interview` RENAME INDEX `Interview_candidateAssignedTestId_fkey` TO `Interview_candidateAssignedTestId_idx`;

-- RenameIndex
ALTER TABLE `LeaveRequest` RENAME INDEX `LeaveRequest_employeeId_fkey` TO `LeaveRequest_employeeId_idx`;

-- RenameIndex
ALTER TABLE `LeaveRequest` RENAME INDEX `LeaveRequest_leaveTypeId_fkey` TO `LeaveRequest_leaveTypeId_idx`;

-- RenameIndex
ALTER TABLE `PerformanceResponse` RENAME INDEX `PerformanceResponse_departmentId_fkey` TO `PerformanceResponse_departmentId_idx`;

-- RenameIndex
ALTER TABLE `PerformanceResponse` RENAME INDEX `PerformanceResponse_employeeId_fkey` TO `PerformanceResponse_employeeId_idx`;

-- RenameIndex
ALTER TABLE `PerformanceSummary` RENAME INDEX `PerformanceSummary_departmentId_fkey` TO `PerformanceSummary_departmentId_idx`;

-- RenameIndex
ALTER TABLE `ShiftAssignment` RENAME INDEX `ShiftAssignment_shiftId_fkey` TO `ShiftAssignment_shiftId_idx`;

-- RenameIndex
ALTER TABLE `Training` RENAME INDEX `Training_departmentId_fkey` TO `Training_departmentId_idx`;

-- RenameIndex
ALTER TABLE `Training` RENAME INDEX `Training_trainerId_fkey` TO `Training_trainerId_idx`;
