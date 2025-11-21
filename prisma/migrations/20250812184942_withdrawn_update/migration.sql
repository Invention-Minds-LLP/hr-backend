-- AlterTable
ALTER TABLE `ResignationRequest` ADD COLUMN `withdrawnAt` DATETIME(3) NULL,
    ADD COLUMN `withdrawnReason` VARCHAR(191) NULL;
