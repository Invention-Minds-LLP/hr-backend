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

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PerformanceFormTemplate` ADD CONSTRAINT `PerformanceFormTemplate_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceQuestion` ADD CONSTRAINT `PerformanceQuestion_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `PerformanceFormTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceResponse` ADD CONSTRAINT `PerformanceResponse_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceResponse` ADD CONSTRAINT `PerformanceResponse_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `PerformanceQuestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceResponse` ADD CONSTRAINT `PerformanceResponse_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceSummary` ADD CONSTRAINT `PerformanceSummary_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceSummary` ADD CONSTRAINT `PerformanceSummary_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceFinalReview` ADD CONSTRAINT `PerformanceFinalReview_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PerformanceFinalReview` ADD CONSTRAINT `PerformanceFinalReview_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
