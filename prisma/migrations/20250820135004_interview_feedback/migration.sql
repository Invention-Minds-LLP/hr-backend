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

    UNIQUE INDEX `InterviewHRReview_interviewId_key`(`interviewId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `InterviewFeedback` ADD CONSTRAINT `InterviewFeedback_interviewId_fkey` FOREIGN KEY (`interviewId`) REFERENCES `Interview`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InterviewHRReview` ADD CONSTRAINT `InterviewHRReview_interviewId_fkey` FOREIGN KEY (`interviewId`) REFERENCES `Interview`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
