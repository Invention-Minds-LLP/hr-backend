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

-- AddForeignKey
ALTER TABLE `ComplaintAcknowledgement` ADD CONSTRAINT `ComplaintAcknowledgement_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComplaintAcknowledgement` ADD CONSTRAINT `ComplaintAcknowledgement_grievanceId_fkey` FOREIGN KEY (`grievanceId`) REFERENCES `Grievance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComplaintAcknowledgement` ADD CONSTRAINT `ComplaintAcknowledgement_poshCaseId_fkey` FOREIGN KEY (`poshCaseId`) REFERENCES `PoshCase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
