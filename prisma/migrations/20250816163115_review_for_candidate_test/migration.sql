-- AlterTable
ALTER TABLE `candidateassignedtest` ADD COLUMN `reviewDecision` VARCHAR(191) NULL,
    ADD COLUMN `reviewNote` VARCHAR(191) NULL,
    ADD COLUMN `reviewedAt` DATETIME(3) NULL,
    ADD COLUMN `reviewedBy` INTEGER NULL;
