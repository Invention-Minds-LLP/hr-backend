-- AlterTable
ALTER TABLE `interview` ADD COLUMN `candidateAssignedTestId` INTEGER NULL;

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

    INDEX `CandidateAssignedTest_applicationId_idx`(`applicationId`),
    INDEX `CandidateAssignedTest_testId_idx`(`testId`),
    INDEX `CandidateAssignedTest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Interview` ADD CONSTRAINT `Interview_candidateAssignedTestId_fkey` FOREIGN KEY (`candidateAssignedTestId`) REFERENCES `CandidateAssignedTest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateAssignedTest` ADD CONSTRAINT `CandidateAssignedTest_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateAssignedTest` ADD CONSTRAINT `CandidateAssignedTest_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `EvaluationTest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
