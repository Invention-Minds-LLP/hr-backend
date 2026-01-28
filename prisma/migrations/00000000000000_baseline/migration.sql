-- CreateTable
CREATE TABLE `Employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeCode` VARCHAR(191) NOT NULL,
    `referenceCode` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `gender` ENUM('MALE', 'FEMALE', 'OTHER') NOT NULL,
    `dob` DATETIME(3) NOT NULL,
    `photoUrl` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `dateOfJoining` DATETIME(3) NOT NULL,
    `employmentType` ENUM('PERMANENT', 'CONTRACT', 'PROBATION') NOT NULL,
    `probationEndDate` DATETIME(3) NULL,
    `employmentStatus` ENUM('ACTIVE', 'TERMINATED', 'SUSPENDED', 'NOTICE_PERIOD', 'RESIGNED') NOT NULL,
    `roleId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `shiftId` INTEGER NULL,
    `sameAsPermanent` BOOLEAN NULL,
    `age` INTEGER NULL,
    `bloodGroup` VARCHAR(191) NULL,
    `reportingManager` INTEGER NULL,
    `employeeType` VARCHAR(191) NULL,
    `alcohol` BOOLEAN NULL,
    `allergies` VARCHAR(191) NULL,
    `bloodPressure` VARCHAR(191) NULL,
    `bloodSugar` VARCHAR(191) NULL,
    `bmi` DOUBLE NULL,
    `cholesterol` VARCHAR(191) NULL,
    `chronicConditions` VARCHAR(191) NULL,
    `emergencyNotes` VARCHAR(191) NULL,
    `exerciseFrequency` VARCHAR(191) NULL,
    `healthIssues` JSON NULL,
    `height` DOUBLE NULL,
    `preEmploymentCheckDate` DATETIME(3) NULL,
    `preferredHospital` VARCHAR(191) NULL,
    `primaryPhysician` VARCHAR(191) NULL,
    `smoking` BOOLEAN NULL,
    `vaccinations` JSON NULL,
    `weight` DOUBLE NULL,
    `pastSurgeries` VARCHAR(191) NULL,
    `usesGlasses` BOOLEAN NULL,
    `visionRemarks` VARCHAR(191) NULL,
    `visionType` VARCHAR(191) NULL,
    `disabilityDescription` VARCHAR(191) NULL,
    `disabilityProofFile` VARCHAR(191) NULL,
    `disabilityProofFileName` VARCHAR(191) NULL,
    `disabilityProofUrl` VARCHAR(191) NULL,
    `disabilityType` VARCHAR(191) NULL,
    `hasDisability` BOOLEAN NULL,
    `healthCheckReminderSent` BOOLEAN NULL DEFAULT false,
    `healthCheckReminderYear` INTEGER NULL,
    `designationId` INTEGER NULL,
    `inchargeId` INTEGER NULL,
    `fatherName` VARCHAR(191) NULL,
    `marital` VARCHAR(191) NULL,
    `totalYearsOfExperience` INTEGER NULL,
    `experience` INTEGER NULL,

    UNIQUE INDEX `Employee_employeeCode_key`(`employeeCode`),
    INDEX `Employee_employmentStatus_idx`(`employmentStatus`),
    INDEX `Employee_departmentId_idx`(`departmentId`),
    INDEX `Employee_branchId_idx`(`branchId`),
    INDEX `Employee_roleId_idx`(`roleId`),
    INDEX `Employee_firstName_idx`(`firstName`),
    INDEX `Employee_lastName_idx`(`lastName`),
    INDEX `Employee_reportingManager_idx`(`reportingManager`),
    INDEX `Employee_inchargeId_idx`(`inchargeId`),
    INDEX `Employee_designationId_fkey`(`designationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmergencyContact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `relationship` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmergencyContact_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Address` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `line1` VARCHAR(191) NOT NULL,
    `line2` VARCHAR(191) NULL,
    `city` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `zipCode` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Address_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Qualification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `degree` VARCHAR(191) NOT NULL,
    `institution` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `degreeName` VARCHAR(191) NULL,
    `grade` VARCHAR(191) NULL,

    INDEX `Qualification_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Document` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `fileUrl` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `expiryDate` DATETIME(3) NULL,
    `category` VARCHAR(191) NOT NULL,
    `issueDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Department_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Branch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Branch_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,

    UNIQUE INDEX `Role_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Permission_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attendance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `checkIn` DATETIME(3) NULL,
    `checkOut` DATETIME(3) NULL,
    `createdBy` INTEGER NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `approvedBy` INTEGER NULL,
    `attendanceApproval` VARCHAR(191) NULL,

    INDEX `Attendance_employeeId_date_idx`(`employeeId`, `date`),
    INDEX `Attendance_status_idx`(`status`),
    UNIQUE INDEX `Attendance_employeeId_date_key`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceSyncLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `window` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `message` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `carryForward` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `LeaveType_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `leaveTypeId` INTEGER NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `approvedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `declineReason` VARCHAR(191) NULL,
    `declinedBy` INTEGER NULL,
    `approvedDate` DATETIME(3) NULL,
    `declinedDate` DATETIME(3) NULL,
    `hodDecidedAt` DATETIME(3) NULL,
    `hodDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hodNote` VARCHAR(191) NULL,
    `hrDecidedAt` DATETIME(3) NULL,
    `hrDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hrNote` VARCHAR(191) NULL,
    `inChargeDecidedAt` DATETIME(3) NULL,
    `inChargeDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `inChargeNote` VARCHAR(191) NULL,

    INDEX `LeaveRequest_employeeId_idx`(`employeeId`),
    INDEX `LeaveRequest_leaveTypeId_idx`(`leaveTypeId`),
    INDEX `LeaveRequest_startDate_idx`(`startDate`),
    INDEX `LeaveRequest_endDate_idx`(`endDate`),
    INDEX `LeaveRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `shiftType` ENUM('MORNING', 'EVENING', 'NIGHT', 'FLEXIBLE', 'NURSING', 'EXECUTIVE', 'REPORTING_MANAGER', 'MOD') NOT NULL,
    `startTime` DATETIME(3) NOT NULL,
    `endTime` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `shiftId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `acknowledged` BOOLEAN NOT NULL DEFAULT false,
    `assignedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ShiftAssignment_shiftId_idx`(`shiftId`),
    INDEX `ShiftAssignment_employeeId_date_idx`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PermissionRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `startTime` DATETIME(3) NULL,
    `endTime` DATETIME(3) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedBy` INTEGER NULL,
    `approvedDate` DATETIME(3) NULL,
    `declineReason` VARCHAR(191) NULL,
    `declinedBy` INTEGER NULL,
    `declinedDate` DATETIME(3) NULL,
    `permissionType` ENUM('PERSONAL', 'OFFICIAL', 'MEDICAL', 'OTHER') NULL,
    `timing` ENUM('FULLDAY', 'HALFDAY', 'HOURLY') NULL,
    `day` DATETIME(3) NOT NULL,
    `hodDecidedAt` DATETIME(3) NULL,
    `hodDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hodNote` VARCHAR(191) NULL,
    `hrDecidedAt` DATETIME(3) NULL,
    `hrDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hrNote` VARCHAR(191) NULL,
    `inChargeDecidedAt` DATETIME(3) NULL,
    `inChargeDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',

    INDEX `PermissionRequest_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BagCheck` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `checkedBy` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `result` ENUM('CLEARED', 'SUSPICIOUS') NOT NULL,
    `remarks` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BagCheck_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuestionBank` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `difficulty` VARCHAR(191) NULL,
    `createdBy` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Question` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `questionBankId` INTEGER NOT NULL,
    `text` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `weight` INTEGER NOT NULL,
    `correctAnswerIds` VARCHAR(191) NULL,
    `evaluationTestId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Question_evaluationTestId_fkey`(`evaluationTestId`),
    INDEX `Question_questionBankId_fkey`(`questionBankId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuestionOption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `questionId` INTEGER NOT NULL,
    `text` VARCHAR(191) NOT NULL,
    `isCorrect` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `QuestionOption_questionId_fkey`(`questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EvaluationTest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `questionBankId` INTEGER NOT NULL,
    `duration` INTEGER NOT NULL,
    `passingPercent` INTEGER NOT NULL,
    `maxAttempts` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activeFrom` DATETIME(3) NULL,
    `activeTo` DATETIME(3) NULL,
    `instructions` VARCHAR(191) NULL,
    `isPublished` BOOLEAN NULL DEFAULT false,
    `level` VARCHAR(191) NULL,
    `purpose` ENUM('HIRING', 'TRAINING', 'ASSESSMENT', 'OTHER') NULL,
    `randomization` ENUM('NONE', 'SHUFFLE_QUESTIONS', 'SHUFFLE_OPTIONS', 'BOTH') NULL DEFAULT 'NONE',
    `role` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EvaluationAttempt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `testId` INTEGER NOT NULL,
    `score` DOUBLE NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `response` LONGTEXT NULL,

    INDEX `EvaluationAttempt_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssignedTest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `testId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `assignedBy` INTEGER NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `completedAt` DATETIME(3) NULL,
    `deadlineDate` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `testDate` DATETIME(3) NULL,
    `trainingAssignmentId` INTEGER NULL,

    INDEX `AssignedTest_employeeId_idx`(`employeeId`),
    INDEX `AssignedTest_testId_fkey`(`testId`),
    INDEX `AssignedTest_trainingAssignmentId_fkey`(`trainingAssignmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppraisalForm` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `cycle` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `overallScore` DOUBLE NULL,
    `finalDecision` VARCHAR(191) NULL,
    `finalComments` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `managerId` INTEGER NULL,

    INDEX `AppraisalForm_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SelfAppraisal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appraisalFormId` INTEGER NOT NULL,
    `achievements` VARCHAR(191) NULL,
    `goalsObjective` VARCHAR(191) NULL,
    `challenges` VARCHAR(191) NULL,
    `trainingNeeds` VARCHAR(191) NULL,
    `communication` DOUBLE NULL,
    `teamwork` DOUBLE NULL,
    `problemSolving` DOUBLE NULL,
    `initiative` DOUBLE NULL,
    `reliability` DOUBLE NULL,
    `overallScore` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SelfAppraisal_appraisalFormId_key`(`appraisalFormId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManagerAppraisal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appraisalFormId` INTEGER NOT NULL,
    `comments` VARCHAR(191) NULL,
    `recommendations` VARCHAR(191) NULL,
    `communication` DOUBLE NULL,
    `teamwork` DOUBLE NULL,
    `problemSolving` DOUBLE NULL,
    `initiative` DOUBLE NULL,
    `reliability` DOUBLE NULL,
    `overallScore` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attendanceComments` VARCHAR(191) NULL,
    `attendanceRating` DOUBLE NULL,
    `guestServiceComments` VARCHAR(191) NULL,
    `guestServiceRating` DOUBLE NULL,
    `independenceComments` VARCHAR(191) NULL,
    `independenceRating` DOUBLE NULL,
    `knowledgeOfJobComments` VARCHAR(191) NULL,
    `knowledgeOfJobRating` DOUBLE NULL,
    `leadershipComments` VARCHAR(191) NULL,
    `leadershipRating` DOUBLE NULL,
    `qualityOfWorkComments` VARCHAR(191) NULL,
    `qualityOfWorkRating` DOUBLE NULL,
    `recordsComments` VARCHAR(191) NULL,
    `recordsRating` DOUBLE NULL,
    `safetyComments` VARCHAR(191) NULL,
    `safetyRating` DOUBLE NULL,
    `teamworkComments` VARCHAR(191) NULL,
    `teamworkRating` DOUBLE NULL,

    UNIQUE INDEX `ManagerAppraisal_appraisalFormId_key`(`appraisalFormId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HRAppraisal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appraisalFormId` INTEGER NOT NULL,
    `comments` VARCHAR(191) NULL,
    `recommendations` VARCHAR(191) NULL,
    `communication` DOUBLE NULL,
    `teamwork` DOUBLE NULL,
    `problemSolving` DOUBLE NULL,
    `initiative` DOUBLE NULL,
    `reliability` DOUBLE NULL,
    `overallScore` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `HRAppraisal_appraisalFormId_key`(`appraisalFormId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NULL,
    `message` VARCHAR(191) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'PUSH') NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeCode` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `lastLogin` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_employeeCode_key`(`employeeCode`),
    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `success` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoginHistory_userId_fkey`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WFHRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `approvedBy` INTEGER NULL,
    `declinedBy` INTEGER NULL,
    `declineReason` VARCHAR(191) NULL,
    `approvedDate` DATETIME(3) NULL,
    `declinedDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `hodDecidedAt` DATETIME(3) NULL,
    `hodDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hodNote` VARCHAR(191) NULL,
    `hrDecidedAt` DATETIME(3) NULL,
    `hrDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hrNote` VARCHAR(191) NULL,

    INDEX `WFHRequest_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EntitlementPolicy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `leaveEntitlement` INTEGER NOT NULL DEFAULT 0,
    `wfhEntitlement` INTEGER NOT NULL DEFAULT 0,
    `permissionEntitlement` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftRotationPattern` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `cycleDays` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `source` VARCHAR(191) NULL,
    `month` INTEGER NULL,
    `year` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftRotationItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `patternId` INTEGER NOT NULL,
    `dayIndex` INTEGER NOT NULL,
    `shiftId` INTEGER NOT NULL,

    INDEX `ShiftRotationItem_shiftId_fkey`(`shiftId`),
    UNIQUE INDEX `ShiftRotationItem_patternId_dayIndex_key`(`patternId`, `dayIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmployeeShiftSetting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `mode` ENUM('FIXED', 'ROTATIONAL') NOT NULL DEFAULT 'FIXED',
    `fixedShiftId` INTEGER NULL,
    `rotationPatternId` INTEGER NULL,
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmployeeShiftSetting_employeeId_key`(`employeeId`),
    INDEX `EmployeeShiftSetting_fixedShiftId_fkey`(`fixedShiftId`),
    INDEX `EmployeeShiftSetting_rotationPatternId_fkey`(`rotationPatternId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResignationRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `managerId` INTEGER NULL,
    `reason` VARCHAR(191) NOT NULL,
    `additionalNotes` VARCHAR(191) NULL,
    `noticePeriodDays` INTEGER NOT NULL DEFAULT 30,
    `proposedLastWorkingDay` DATETIME(3) NOT NULL,
    `actualLastWorkingDay` DATETIME(3) NULL,
    `status` ENUM('SUBMITTED', 'UNDER_REVIEW', 'ON_HOLD', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'WITHDRAW_REQUESTED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'SUBMITTED',
    `managerDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `managerDecidedAt` DATETIME(3) NULL,
    `managerNote` VARCHAR(191) NULL,
    `hrDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hrDecidedAt` DATETIME(3) NULL,
    `hrNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `withdrawnAt` DATETIME(3) NULL,
    `withdrawnReason` VARCHAR(191) NULL,
    `withdrawDecidedAt` DATETIME(3) NULL,
    `withdrawDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NULL,
    `withdrawRequestedAt` DATETIME(3) NULL,
    `withdrawStatusChangedBy` INTEGER NULL,

    INDEX `ResignationRequest_employeeId_idx`(`employeeId`),
    INDEX `ResignationRequest_managerId_idx`(`managerId`),
    INDEX `ResignationRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResignationHandoverTask` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `resignationId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `assigneeId` INTEGER NULL,
    `dueDate` DATETIME(3) NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'DONE') NOT NULL DEFAULT 'OPEN',
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ResignationHandoverTask_resignationId_idx`(`resignationId`),
    INDEX `ResignationHandoverTask_assigneeId_idx`(`assigneeId`),
    INDEX `ResignationHandoverTask_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResignationClearance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `resignationId` INTEGER NOT NULL,
    `type` ENUM('IT', 'FINANCE', 'HR', 'ADMIN', 'SECURITY', 'OTHER') NOT NULL,
    `decision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `verifierId` INTEGER NULL,
    `note` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ResignationClearance_resignationId_idx`(`resignationId`),
    INDEX `ResignationClearance_verifierId_fkey`(`verifierId`),
    UNIQUE INDEX `ResignationClearance_resignationId_type_key`(`resignationId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResignationDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `resignationId` INTEGER NOT NULL,
    `relievingLetterUrl` VARCHAR(191) NULL,
    `experienceLetterUrl` VARCHAR(191) NULL,
    `otherUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clearanceCertificateUrl` VARCHAR(191) NULL,
    `clearanceIssuedAt` DATETIME(3) NULL,
    `clearanceCertificateCode` VARCHAR(191) NULL,

    UNIQUE INDEX `ResignationDocument_resignationId_key`(`resignationId`),
    UNIQUE INDEX `ResignationDocument_clearanceCertificateCode_key`(`clearanceCertificateCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExitInterview` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `resignationId` INTEGER NOT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `interviewerId` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `outcome` VARCHAR(191) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `academicQualification` VARCHAR(191) NULL,
    `attitudeSuperiors` VARCHAR(191) NULL,
    `companyOpinion` VARCHAR(191) NULL,
    `demotivating` VARCHAR(191) NULL,
    `discrimination` BOOLEAN NULL,
    `dissatisfaction` VARCHAR(191) NULL,
    `employeeId` INTEGER NULL,
    `expectationsMet` VARCHAR(191) NULL,
    `influencedFactors` VARCHAR(191) NULL,
    `jobOpinion` VARCHAR(191) NULL,
    `leastSatisfying` VARCHAR(191) NULL,
    `likedMost` VARCHAR(191) NULL,
    `mostSatisfying` VARCHAR(191) NULL,
    `newJobOffers` VARCHAR(191) NULL,
    `newJobSalaryComparison` VARCHAR(191) NULL,
    `nextOrgCategory` VARCHAR(191) NULL,
    `nextOrgIndustry` VARCHAR(191) NULL,
    `nextOrgLocation` VARCHAR(191) NULL,
    `nextOrgName` VARCHAR(191) NULL,
    `nextOrgPosition` VARCHAR(191) NULL,
    `reasonForLeaving` VARCHAR(191) NULL,
    `recommendCompany` BOOLEAN NULL,
    `recommendReason` VARCHAR(191) NULL,
    `recruitmentMode` VARCHAR(191) NULL,
    `skillUtilization` VARCHAR(191) NULL,
    `stayEncouragement` VARCHAR(191) NULL,
    `supportReceived` VARCHAR(191) NULL,
    `triggerReason` VARCHAR(191) NULL,
    `vacancySource` VARCHAR(191) NULL,

    UNIQUE INDEX `ExitInterview_resignationId_key`(`resignationId`),
    INDEX `ExitInterview_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FinalSettlement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `resignationId` INTEGER NOT NULL,
    `status` ENUM('DUE', 'PROCESSING', 'PAID') NOT NULL DEFAULT 'DUE',
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FinalSettlement_resignationId_key`(`resignationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `location` VARCHAR(191) NULL,
    `headcount` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('OPEN', 'ON_HOLD', 'CLOSED', 'DRAFT') NOT NULL DEFAULT 'OPEN',
    `createdBy` INTEGER NOT NULL,
    `backfillForEmployeeId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Job_status_idx`(`status`),
    INDEX `Job_departmentId_idx`(`departmentId`),
    INDEX `Job_title_idx`(`title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Candidate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL,
    `resumeUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastLogin` DATETIME(3) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `experience` VARCHAR(191) NULL,
    `qualification` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,

    UNIQUE INDEX `Candidate_email_key`(`email`),
    INDEX `Candidate_name_idx`(`name`),
    INDEX `Candidate_source_idx`(`source`),
    INDEX `Candidate_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CandidateLoginHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `success` BOOLEAN NOT NULL,

    INDEX `CandidateLoginHistory_candidateId_fkey`(`candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Application` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jobId` INTEGER NOT NULL,
    `candidateId` INTEGER NOT NULL,
    `status` ENUM('APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'OFFERED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'REJECTED', 'WITHDRAWN', 'HIRED', 'NO_SHOW') NOT NULL DEFAULT 'APPLIED',
    `currentStage` VARCHAR(191) NULL,
    `rejectReason` ENUM('SALARY', 'ROLE_MISMATCH', 'LOCATION', 'EXPERIENCE', 'CULTURE', 'OTHER') NULL,
    `expectedCtc` DOUBLE NULL,
    `noticeDays` INTEGER NULL,
    `salaryNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `experience` VARCHAR(191) NULL,
    `qualification` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL,
    `shortlistNote` VARCHAR(191) NULL,

    INDEX `Application_jobId_status_idx`(`jobId`, `status`),
    INDEX `Application_candidateId_idx`(`candidateId`),
    INDEX `Application_updatedAt_idx`(`updatedAt`),
    INDEX `Application_status_idx`(`status`),
    INDEX `Application_jobId_idx`(`jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Interview` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `applicationId` INTEGER NOT NULL,
    `stage` VARCHAR(191) NOT NULL,
    `startTime` DATETIME(3) NOT NULL,
    `endTime` DATETIME(3) NOT NULL,
    `panelUserIds` VARCHAR(191) NULL,
    `feedbackUrl` VARCHAR(191) NULL,
    `feedbackDue` DATETIME(3) NULL,
    `feedbackAt` DATETIME(3) NULL,
    `result` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `candidateAssignedTestId` INTEGER NULL,

    INDEX `Interview_startTime_idx`(`startTime`),
    INDEX `Interview_applicationId_idx`(`applicationId`),
    INDEX `Interview_stage_idx`(`stage`),
    INDEX `Interview_candidateAssignedTestId_idx`(`candidateAssignedTestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Offer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `applicationId` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'WITHDRAWN', 'EXPIRED') NOT NULL DEFAULT 'DRAFT',
    `sentAt` DATETIME(3) NULL,
    `viewedAt` DATETIME(3) NULL,
    `signedAt` DATETIME(3) NULL,
    `declinedAt` DATETIME(3) NULL,
    `declineReason` VARCHAR(191) NULL,
    `proposedJoinAt` DATETIME(3) NULL,
    `joinOutcome` ENUM('JOINED', 'NO_SHOW', 'DEFERRED') NULL,
    `noShowReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Offer_applicationId_key`(`applicationId`),
    INDEX `Offer_status_idx`(`status`),
    INDEX `Offer_proposedJoinAt_idx`(`proposedJoinAt`),
    INDEX `Offer_signedAt_idx`(`signedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `audience` VARCHAR(191) NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NULL,
    `createdBy` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attachments` VARCHAR(191) NULL,
    `circularCode` VARCHAR(191) NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `requireAck` BOOLEAN NOT NULL DEFAULT false,
    `type` VARCHAR(191) NULL,

    UNIQUE INDEX `Announcement_circularCode_key`(`circularCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnnouncementAck` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `announcementId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `acknowledgedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AnnouncementAck_announcementId_idx`(`announcementId`),
    INDEX `AnnouncementAck_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `AnnouncementAck_announcementId_employeeId_key`(`announcementId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Internship` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NULL,
    `mentorId` INTEGER NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'OFFERED', 'ACTIVE', 'COMPLETED', 'CONVERTED', 'DROPPED') NOT NULL DEFAULT 'ACTIVE',
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `candidateName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `stipend` INTEGER NULL,
    `title` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `certificateCode` VARCHAR(191) NULL,
    `certificateIssuedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Internship_certificateCode_key`(`certificateCode`),
    INDEX `Internship_status_idx`(`status`),
    INDEX `Internship_startDate_idx`(`startDate`),
    INDEX `Internship_mentorId_idx`(`mentorId`),
    INDEX `Internship_departmentId_idx`(`departmentId`),
    INDEX `Internship_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CandidateAssignedTest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `applicationId` INTEGER NOT NULL,
    `candidateId` INTEGER NOT NULL,
    `testId` INTEGER NOT NULL,
    `assignedBy` INTEGER NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `testDate` DATETIME(3) NULL,
    `deadlineDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'NotStarted',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `score` DOUBLE NULL,
    `response` VARCHAR(191) NULL,
    `reviewDecision` VARCHAR(191) NULL,
    `reviewNote` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedBy` INTEGER NULL,

    INDEX `CandidateAssignedTest_applicationId_idx`(`applicationId`),
    INDEX `CandidateAssignedTest_testId_idx`(`testId`),
    INDEX `CandidateAssignedTest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InterviewFeedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `interviewId` INTEGER NOT NULL,
    `panelUserId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `designation` VARCHAR(191) NULL,
    `jobSkills` INTEGER NULL,
    `jobKnowledge` INTEGER NULL,
    `attitude` INTEGER NULL,
    `communication` INTEGER NULL,
    `average` DOUBLE NULL,
    `notes` VARCHAR(191) NULL,
    `signature` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'SUBMITTED') NOT NULL DEFAULT 'DRAFT',
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InterviewFeedback_interviewId_idx`(`interviewId`),
    INDEX `InterviewFeedback_panelUserId_idx`(`panelUserId`),
    INDEX `InterviewFeedback_status_idx`(`status`),
    UNIQUE INDEX `InterviewFeedback_interviewId_panelUserId_key`(`interviewId`, `panelUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InterviewHRReview` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `interviewId` INTEGER NOT NULL,
    `presentSalary` INTEGER NULL,
    `payslip` BOOLEAN NULL,
    `expectedSalary` INTEGER NULL,
    `grossOffer` INTEGER NULL,
    `conclusion` VARCHAR(191) NULL,
    `remarks` VARCHAR(191) NULL,
    `reviewerUserId` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expectedDoj` DATETIME(3) NULL,
    `noticePeriod` INTEGER NULL,

    UNIQUE INDEX `InterviewHRReview_interviewId_key`(`interviewId`),
    INDEX `InterviewHRReview_reviewerUserId_idx`(`reviewerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OvertimeApproval` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `minutes` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `scheduledEnd` DATETIME(3) NULL,
    `checkOut` DATETIME(3) NULL,

    UNIQUE INDEX `OvertimeApproval_employeeId_date_key`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmployeeSurvey` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `submittedAt` DATETIME(3) NULL,

    INDEX `EmployeeSurvey_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SurveyQuestion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `section` VARCHAR(191) NOT NULL,
    `questionText` VARCHAR(191) NOT NULL,
    `orderNo` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SurveyResponse` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `surveyId` INTEGER NOT NULL,
    `questionId` INTEGER NOT NULL,
    `answer` VARCHAR(191) NOT NULL,

    INDEX `SurveyResponse_questionId_fkey`(`questionId`),
    INDEX `SurveyResponse_surveyId_fkey`(`surveyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PerformanceFormTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `departmentId` INTEGER NOT NULL,
    `cycle` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PerformanceFormTemplate_departmentId_cycle_key`(`departmentId`, `cycle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PerformanceQuestion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `text` VARCHAR(191) NOT NULL,
    `orderNo` INTEGER NOT NULL,
    `weight` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PerformanceQuestion_templateId_fkey`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PerformanceResponse` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `cycle` VARCHAR(191) NOT NULL,
    `questionId` INTEGER NOT NULL,
    `period` ENUM('MONTH_1', 'MONTH_3', 'MONTH_6', 'YEAR_1', 'YEAR_2') NOT NULL,
    `score` INTEGER NULL,
    `reviewerId` INTEGER NULL,
    `comments` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PerformanceResponse_employeeId_idx`(`employeeId`),
    INDEX `PerformanceResponse_departmentId_idx`(`departmentId`),
    INDEX `PerformanceResponse_cycle_idx`(`cycle`),
    INDEX `PerformanceResponse_questionId_fkey`(`questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PerformanceSummary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `cycle` VARCHAR(191) NOT NULL,
    `period` ENUM('MONTH_1', 'MONTH_3', 'MONTH_6', 'YEAR_1', 'YEAR_2') NOT NULL,
    `marksScored` INTEGER NULL,
    `overallPerf` VARCHAR(191) NULL,
    `employeeSig` TEXT NULL,
    `supervisorSig` TEXT NULL,
    `hodSig` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PerformanceSummary_employeeId_cycle_idx`(`employeeId`, `cycle`),
    INDEX `PerformanceSummary_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PerformanceFinalReview` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `cycle` VARCHAR(191) NOT NULL,
    `appreciations` VARCHAR(191) NULL,
    `talents` VARCHAR(191) NULL,
    `overallComments` VARCHAR(191) NULL,
    `employeeSig` TEXT NULL,
    `supervisorSig` TEXT NULL,
    `hrSig` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PerformanceFinalReview_departmentId_fkey`(`departmentId`),
    INDEX `PerformanceFinalReview_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManpowerRequisition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jobId` INTEGER NULL,
    `requestDate` DATETIME(3) NOT NULL,
    `designation` VARCHAR(191) NULL,
    `reasonType` VARCHAR(191) NOT NULL,
    `reasonDetails` VARCHAR(191) NULL,
    `vacancies` INTEGER NULL,
    `minExperience` INTEGER NULL,
    `maxExperience` INTEGER NULL,
    `skills` VARCHAR(191) NULL,
    `education` VARCHAR(191) NULL,
    `training` VARCHAR(191) NULL,
    `reasonBreakdown` JSON NULL,
    `eduSSC` BOOLEAN NULL,
    `eduDiploma` BOOLEAN NULL,
    `eduBachelor` BOOLEAN NULL,
    `eduMaster` BOOLEAN NULL,
    `eduOther` VARCHAR(191) NULL,
    `urgent` BOOLEAN NULL DEFAULT false,
    `duration` VARCHAR(191) NULL,
    `reportingTo` VARCHAR(191) NULL,
    `raisedBy` VARCHAR(191) NULL,
    `raisedBySign` LONGTEXT NULL,
    `raisedByDate` DATETIME(3) NULL,
    `raisedByComments` VARCHAR(191) NULL,
    `approvedByHoD` VARCHAR(191) NULL,
    `hodSign` LONGTEXT NULL,
    `approvedByHoDDate` DATETIME(3) NULL,
    `approvedByHoDComments` VARCHAR(191) NULL,
    `approvedBySMO` VARCHAR(191) NULL,
    `smoSign` LONGTEXT NULL,
    `approvedBySMODate` DATETIME(3) NULL,
    `approvedBySMOComments` VARCHAR(191) NULL,
    `receivedByHR` VARCHAR(191) NULL,
    `hrSign` LONGTEXT NULL,
    `receivedByHRDate` DATETIME(3) NULL,
    `receivedByHRComments` VARCHAR(191) NULL,
    `hrReferenceNo` VARCHAR(191) NULL,
    `salaryRange` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL,
    `actionTaken` VARCHAR(191) NULL,
    `closedOn` DATETIME(3) NULL,
    `hrRemarks` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RAISED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `departmentId` INTEGER NULL,
    `eduOtherDetail` BOOLEAN NULL,
    `eduBachelorDetail` VARCHAR(191) NULL,
    `eduDiplomaDetail` VARCHAR(191) NULL,
    `eduMasterDetail` VARCHAR(191) NULL,
    `eduSSCDetail` VARCHAR(191) NULL,
    `title` VARCHAR(191) NULL,
    `hodRejectedBy` VARCHAR(191) NULL,
    `hodRejectedComments` VARCHAR(191) NULL,
    `hodRejectedDate` DATETIME(3) NULL,
    `hrRejectedBy` VARCHAR(191) NULL,
    `hrRejectedComments` VARCHAR(191) NULL,
    `hrRejectedDate` DATETIME(3) NULL,
    `smoRejectedBy` VARCHAR(191) NULL,
    `smoRejectedComments` VARCHAR(191) NULL,
    `smoRejectedDate` DATETIME(3) NULL,

    UNIQUE INDEX `ManpowerRequisition_jobId_key`(`jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Grievance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `status` ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Grievance_status_idx`(`status`),
    INDEX `Grievance_employeeId_fkey`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GrievanceComment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grievanceId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `comment` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GrievanceComment_employeeId_fkey`(`employeeId`),
    INDEX `GrievanceComment_grievanceId_fkey`(`grievanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PoshCase` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `complainantId` INTEGER NOT NULL,
    `accusedId` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `status` ENUM('FILED', 'UNDER_INVESTIGATION', 'CLOSED', 'REJECTED') NOT NULL DEFAULT 'FILED',
    `committeeNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PoshCase_status_idx`(`status`),
    INDEX `PoshCase_accusedId_fkey`(`accusedId`),
    INDEX `PoshCase_complainantId_fkey`(`complainantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PoshHearing` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poshId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `outcome` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PoshHearing_poshId_fkey`(`poshId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Training` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `objectives` TEXT NULL,
    `trainerType` VARCHAR(191) NULL,
    `trainerId` INTEGER NULL,
    `trainerName` VARCHAR(191) NULL,
    `trainerOrg` VARCHAR(191) NULL,
    `mode` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `durationHours` DOUBLE NULL,
    `departmentId` INTEGER NULL,
    `createdBy` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `trainers` JSON NULL,

    INDEX `Training_status_idx`(`status`),
    INDEX `Training_departmentId_idx`(`departmentId`),
    INDEX `Training_trainerId_idx`(`trainerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrainingTest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trainingId` INTEGER NOT NULL,
    `testId` INTEGER NOT NULL,
    `isMandatory` BOOLEAN NOT NULL DEFAULT true,
    `orderNo` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deadlineDate` DATETIME(3) NULL,
    `testDate` DATETIME(3) NULL,

    INDEX `TrainingTest_testId_fkey`(`testId`),
    UNIQUE INDEX `TrainingTest_trainingId_testId_key`(`trainingId`, `testId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrainingAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trainingId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `assignedBy` INTEGER NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'NotStarted',
    `progress` DOUBLE NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TrainingAssignment_status_idx`(`status`),
    INDEX `TrainingAssignment_employeeId_fkey`(`employeeId`),
    UNIQUE INDEX `TrainingAssignment_trainingId_employeeId_key`(`trainingId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrainingFeedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trainingId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `rating` INTEGER NULL,
    `feedback` VARCHAR(191) NULL,
    `trainerRating` INTEGER NULL,
    `contentQuality` INTEGER NULL,
    `relevance` INTEGER NULL,
    `suggestions` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TrainingFeedback_trainingId_idx`(`trainingId`),
    INDEX `TrainingFeedback_employeeId_fkey`(`employeeId`),
    UNIQUE INDEX `TrainingFeedback_trainingId_employeeId_key`(`trainingId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComplaintAcknowledgement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `grievanceId` INTEGER NULL,
    `poshCaseId` INTEGER NULL,
    `acknowledgedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ComplaintAcknowledgement_employeeId_idx`(`employeeId`),
    INDEX `ComplaintAcknowledgement_grievanceId_idx`(`grievanceId`),
    INDEX `ComplaintAcknowledgement_poshCaseId_idx`(`poshCaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmployeeLeaveBalance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `leaveTypeId` INTEGER NULL,
    `permissionType` ENUM('PERSONAL', 'OFFICIAL', 'MEDICAL', 'OTHER') NULL,
    `category` ENUM('LEAVE', 'PERMISSION') NOT NULL,
    `year` INTEGER NOT NULL,
    `totalAllowed` INTEGER NOT NULL DEFAULT 0,
    `used` INTEGER NOT NULL DEFAULT 0,

    INDEX `EmployeeLeaveBalance_leaveTypeId_fkey`(`leaveTypeId`),
    UNIQUE INDEX `EmployeeLeaveBalance_employeeId_leaveTypeId_year_key`(`employeeId`, `leaveTypeId`, `year`),
    UNIQUE INDEX `EmployeeLeaveBalance_employeeId_permissionType_year_key`(`employeeId`, `permissionType`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrainingAttendance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trainingId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `markedAt` DATETIME(3) NULL,
    `markedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TrainingAttendance_trainingId_idx`(`trainingId`),
    INDEX `TrainingAttendance_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `TrainingAttendance_trainingId_employeeId_date_key`(`trainingId`, `employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Incident` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `reportedBy` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `attachment` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Incident_employeeId_fkey`(`employeeId`),
    INDEX `Incident_reportedBy_fkey`(`reportedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Designation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Designation_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceToken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DeviceToken_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LateLoginLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `shiftStart` DATETIME(3) NOT NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `lateMinutes` INTEGER NOT NULL,
    `source` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LateLoginLog_employeeId_idx`(`employeeId`),
    INDEX `LateLoginLog_date_idx`(`date`),
    UNIQUE INDEX `LateLoginLog_employeeId_date_key`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MobileAuthSession` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `phoneVerified` BOOLEAN NOT NULL DEFAULT false,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `identityOk` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MobileAuthSession_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshToken_token_key`(`token`),
    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceNotificationLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uniqueKey` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `shiftId` INTEGER NOT NULL,
    `runAt` DATETIME(3) NOT NULL,
    `lateCount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AttendanceNotificationLog_uniqueKey_key`(`uniqueKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HolidayCalendar` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `HolidayCalendar_year_key`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Holiday` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `calendarId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isOptional` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Holiday_date_idx`(`date`),
    UNIQUE INDEX `Holiday_calendarId_date_key`(`calendarId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftApproval` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `rmDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `rmDecidedAt` DATETIME(3) NULL,
    `rmRejectReason` TEXT NULL,
    `hrDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hrDecidedAt` DATETIME(3) NULL,
    `hrRejectReason` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `fixedShiftId` INTEGER NULL,
    `hasIncharge` BOOLEAN NOT NULL,
    `patternId` INTEGER NULL,
    `month` INTEGER NULL,
    `year` INTEGER NULL,
    `isMonthly` BOOLEAN NULL DEFAULT true,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestedBy` INTEGER NOT NULL,
    `appliedAt` DATETIME(3) NULL,
    `requestedMode` ENUM('FIXED', 'ROTATIONAL') NOT NULL,
    `startDate` DATETIME(3) NOT NULL,

    INDEX `ShiftApproval_employeeId_idx`(`employeeId`),
    INDEX `ShiftApproval_fixedShiftId_idx`(`fixedShiftId`),
    INDEX `ShiftApproval_patternId_idx`(`patternId`),
    INDEX `ShiftApproval_requestedBy_idx`(`requestedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_PermissionToRole` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_PermissionToRole_AB_unique`(`A`, `B`),
    INDEX `_PermissionToRole_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_designationId_fkey` FOREIGN KEY (`designationId`) REFERENCES `Designation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_inchargeId_fkey` FOREIGN KEY (`inchargeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmergencyContact` ADD CONSTRAINT `EmergencyContact_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Qualification` ADD CONSTRAINT `Qualification_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `LeaveType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftAssignment` ADD CONSTRAINT `ShiftAssignment_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftAssignment` ADD CONSTRAINT `ShiftAssignment_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PermissionRequest` ADD CONSTRAINT `PermissionRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BagCheck` ADD CONSTRAINT `BagCheck_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Question` ADD CONSTRAINT `Question_evaluationTestId_fkey` FOREIGN KEY (`evaluationTestId`) REFERENCES `EvaluationTest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Question` ADD CONSTRAINT `Question_questionBankId_fkey` FOREIGN KEY (`questionBankId`) REFERENCES `QuestionBank`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuestionOption` ADD CONSTRAINT `QuestionOption_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `Question`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EvaluationAttempt` ADD CONSTRAINT `EvaluationAttempt_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignedTest` ADD CONSTRAINT `AssignedTest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignedTest` ADD CONSTRAINT `AssignedTest_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `EvaluationTest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignedTest` ADD CONSTRAINT `AssignedTest_trainingAssignmentId_fkey` FOREIGN KEY (`trainingAssignmentId`) REFERENCES `TrainingAssignment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppraisalForm` ADD CONSTRAINT `AppraisalForm_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SelfAppraisal` ADD CONSTRAINT `SelfAppraisal_appraisalFormId_fkey` FOREIGN KEY (`appraisalFormId`) REFERENCES `AppraisalForm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManagerAppraisal` ADD CONSTRAINT `ManagerAppraisal_appraisalFormId_fkey` FOREIGN KEY (`appraisalFormId`) REFERENCES `AppraisalForm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HRAppraisal` ADD CONSTRAINT `HRAppraisal_appraisalFormId_fkey` FOREIGN KEY (`appraisalFormId`) REFERENCES `AppraisalForm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_employeeCode_fkey` FOREIGN KEY (`employeeCode`) REFERENCES `Employee`(`employeeCode`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoginHistory` ADD CONSTRAINT `LoginHistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WFHRequest` ADD CONSTRAINT `WFHRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftRotationItem` ADD CONSTRAINT `ShiftRotationItem_patternId_fkey` FOREIGN KEY (`patternId`) REFERENCES `ShiftRotationPattern`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftRotationItem` ADD CONSTRAINT `ShiftRotationItem_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeShiftSetting` ADD CONSTRAINT `EmployeeShiftSetting_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeShiftSetting` ADD CONSTRAINT `EmployeeShiftSetting_fixedShiftId_fkey` FOREIGN KEY (`fixedShiftId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeShiftSetting` ADD CONSTRAINT `EmployeeShiftSetting_rotationPatternId_fkey` FOREIGN KEY (`rotationPatternId`) REFERENCES `ShiftRotationPattern`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResignationRequest` ADD CONSTRAINT `ResignationRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResignationHandoverTask` ADD CONSTRAINT `ResignationHandoverTask_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResignationClearance` ADD CONSTRAINT `ResignationClearance_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResignationClearance` ADD CONSTRAINT `ResignationClearance_verifierId_fkey` FOREIGN KEY (`verifierId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResignationDocument` ADD CONSTRAINT `ResignationDocument_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExitInterview` ADD CONSTRAINT `ExitInterview_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExitInterview` ADD CONSTRAINT `ExitInterview_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinalSettlement` ADD CONSTRAINT `FinalSettlement_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateLoginHistory` ADD CONSTRAINT `CandidateLoginHistory_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Application` ADD CONSTRAINT `Application_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Application` ADD CONSTRAINT `Application_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Interview` ADD CONSTRAINT `Interview_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Interview` ADD CONSTRAINT `Interview_candidateAssignedTestId_fkey` FOREIGN KEY (`candidateAssignedTestId`) REFERENCES `CandidateAssignedTest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Offer` ADD CONSTRAINT `Offer_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnouncementAck` ADD CONSTRAINT `AnnouncementAck_announcementId_fkey` FOREIGN KEY (`announcementId`) REFERENCES `Announcement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnouncementAck` ADD CONSTRAINT `AnnouncementAck_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Internship` ADD CONSTRAINT `Internship_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Internship` ADD CONSTRAINT `Internship_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateAssignedTest` ADD CONSTRAINT `CandidateAssignedTest_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateAssignedTest` ADD CONSTRAINT `CandidateAssignedTest_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `EvaluationTest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InterviewFeedback` ADD CONSTRAINT `InterviewFeedback_interviewId_fkey` FOREIGN KEY (`interviewId`) REFERENCES `Interview`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InterviewHRReview` ADD CONSTRAINT `InterviewHRReview_interviewId_fkey` FOREIGN KEY (`interviewId`) REFERENCES `Interview`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OvertimeApproval` ADD CONSTRAINT `OvertimeApproval_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeSurvey` ADD CONSTRAINT `EmployeeSurvey_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SurveyResponse` ADD CONSTRAINT `SurveyResponse_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `SurveyQuestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SurveyResponse` ADD CONSTRAINT `SurveyResponse_surveyId_fkey` FOREIGN KEY (`surveyId`) REFERENCES `EmployeeSurvey`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceFormTemplate` ADD CONSTRAINT `PerformanceFormTemplate_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceQuestion` ADD CONSTRAINT `PerformanceQuestion_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `PerformanceFormTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceResponse` ADD CONSTRAINT `PerformanceResponse_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceResponse` ADD CONSTRAINT `PerformanceResponse_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceResponse` ADD CONSTRAINT `PerformanceResponse_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `PerformanceQuestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceSummary` ADD CONSTRAINT `PerformanceSummary_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceSummary` ADD CONSTRAINT `PerformanceSummary_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceFinalReview` ADD CONSTRAINT `PerformanceFinalReview_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceFinalReview` ADD CONSTRAINT `PerformanceFinalReview_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManpowerRequisition` ADD CONSTRAINT `ManpowerRequisition_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Grievance` ADD CONSTRAINT `Grievance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GrievanceComment` ADD CONSTRAINT `GrievanceComment_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GrievanceComment` ADD CONSTRAINT `GrievanceComment_grievanceId_fkey` FOREIGN KEY (`grievanceId`) REFERENCES `Grievance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoshCase` ADD CONSTRAINT `PoshCase_accusedId_fkey` FOREIGN KEY (`accusedId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoshCase` ADD CONSTRAINT `PoshCase_complainantId_fkey` FOREIGN KEY (`complainantId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoshHearing` ADD CONSTRAINT `PoshHearing_poshId_fkey` FOREIGN KEY (`poshId`) REFERENCES `PoshCase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Training` ADD CONSTRAINT `Training_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Training` ADD CONSTRAINT `Training_trainerId_fkey` FOREIGN KEY (`trainerId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingTest` ADD CONSTRAINT `TrainingTest_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `EvaluationTest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingTest` ADD CONSTRAINT `TrainingTest_trainingId_fkey` FOREIGN KEY (`trainingId`) REFERENCES `Training`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingAssignment` ADD CONSTRAINT `TrainingAssignment_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingAssignment` ADD CONSTRAINT `TrainingAssignment_trainingId_fkey` FOREIGN KEY (`trainingId`) REFERENCES `Training`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingFeedback` ADD CONSTRAINT `TrainingFeedback_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingFeedback` ADD CONSTRAINT `TrainingFeedback_trainingId_fkey` FOREIGN KEY (`trainingId`) REFERENCES `Training`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComplaintAcknowledgement` ADD CONSTRAINT `ComplaintAcknowledgement_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComplaintAcknowledgement` ADD CONSTRAINT `ComplaintAcknowledgement_grievanceId_fkey` FOREIGN KEY (`grievanceId`) REFERENCES `Grievance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComplaintAcknowledgement` ADD CONSTRAINT `ComplaintAcknowledgement_poshCaseId_fkey` FOREIGN KEY (`poshCaseId`) REFERENCES `PoshCase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeLeaveBalance` ADD CONSTRAINT `EmployeeLeaveBalance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeLeaveBalance` ADD CONSTRAINT `EmployeeLeaveBalance_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `LeaveType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingAttendance` ADD CONSTRAINT `TrainingAttendance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingAttendance` ADD CONSTRAINT `TrainingAttendance_trainingId_fkey` FOREIGN KEY (`trainingId`) REFERENCES `Training`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_reportedBy_fkey` FOREIGN KEY (`reportedBy`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LateLoginLog` ADD CONSTRAINT `LateLoginLog_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MobileAuthSession` ADD CONSTRAINT `MobileAuthSession_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Holiday` ADD CONSTRAINT `Holiday_calendarId_fkey` FOREIGN KEY (`calendarId`) REFERENCES `HolidayCalendar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_patternId_fkey` FOREIGN KEY (`patternId`) REFERENCES `ShiftRotationPattern`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_fixedShiftId_fkey` FOREIGN KEY (`fixedShiftId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_requestedBy_fkey` FOREIGN KEY (`requestedBy`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_PermissionToRole` ADD CONSTRAINT `_PermissionToRole_A_fkey` FOREIGN KEY (`A`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_PermissionToRole` ADD CONSTRAINT `_PermissionToRole_B_fkey` FOREIGN KEY (`B`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

