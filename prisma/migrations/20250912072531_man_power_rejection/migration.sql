-- AlterTable
ALTER TABLE `manpowerrequisition` ADD COLUMN `hodRejectedBy` VARCHAR(191) NULL,
    ADD COLUMN `hodRejectedComments` VARCHAR(191) NULL,
    ADD COLUMN `hodRejectedDate` DATETIME(3) NULL,
    ADD COLUMN `hrRejectedBy` VARCHAR(191) NULL,
    ADD COLUMN `hrRejectedComments` VARCHAR(191) NULL,
    ADD COLUMN `hrRejectedDate` DATETIME(3) NULL,
    ADD COLUMN `smoRejectedBy` VARCHAR(191) NULL,
    ADD COLUMN `smoRejectedComments` VARCHAR(191) NULL,
    ADD COLUMN `smoRejectedDate` DATETIME(3) NULL;
