-- AlterTable
ALTER TABLE `Attendance` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedBy` INTEGER NULL,
    ADD COLUMN `attendanceApproval` VARCHAR(191) NULL;
