-- AlterTable
ALTER TABLE `ShiftApproval` ADD COLUMN `appliedAt` DATETIME(3) NULL,
    ADD COLUMN `hrRejectReason` TEXT NULL,
    ADD COLUMN `rmRejectReason` TEXT NULL;
