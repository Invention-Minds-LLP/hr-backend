-- AlterTable
ALTER TABLE `assignedtest` ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `deadlineDate` DATETIME(3) NULL,
    ADD COLUMN `startedAt` DATETIME(3) NULL,
    ADD COLUMN `testDate` DATETIME(3) NULL;
