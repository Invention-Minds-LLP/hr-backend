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
    `status` ENUM('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'SUBMITTED',
    `managerDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `managerDecidedAt` DATETIME(3) NULL,
    `managerNote` VARCHAR(191) NULL,
    `hrDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hrDecidedAt` DATETIME(3) NULL,
    `hrNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

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

    UNIQUE INDEX `ResignationDocument_resignationId_key`(`resignationId`),
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

    UNIQUE INDEX `ExitInterview_resignationId_key`(`resignationId`),
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

-- AddForeignKey
ALTER TABLE `ResignationRequest` ADD CONSTRAINT `ResignationRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResignationHandoverTask` ADD CONSTRAINT `ResignationHandoverTask_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResignationClearance` ADD CONSTRAINT `ResignationClearance_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResignationDocument` ADD CONSTRAINT `ResignationDocument_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExitInterview` ADD CONSTRAINT `ExitInterview_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinalSettlement` ADD CONSTRAINT `FinalSettlement_resignationId_fkey` FOREIGN KEY (`resignationId`) REFERENCES `ResignationRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
