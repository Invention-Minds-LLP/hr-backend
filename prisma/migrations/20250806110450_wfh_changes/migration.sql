-- AlterTable
ALTER TABLE `LeaveRequest` ADD COLUMN `approvedDate` DATETIME(3) NULL,
    ADD COLUMN `declinedDate` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `PermissionRequest` ADD COLUMN `approvedBy` INTEGER NULL,
    ADD COLUMN `approvedDate` DATETIME(3) NULL,
    ADD COLUMN `declineReason` VARCHAR(191) NULL,
    ADD COLUMN `declinedBy` INTEGER NULL,
    ADD COLUMN `declinedDate` DATETIME(3) NULL;

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

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WFHRequest` ADD CONSTRAINT `WFHRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
