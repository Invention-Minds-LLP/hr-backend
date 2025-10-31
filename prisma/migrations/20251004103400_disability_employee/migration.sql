-- AlterTable
ALTER TABLE `employee` ADD COLUMN `disabilities` VARCHAR(191) NULL,
    ADD COLUMN `pastSurgeries` VARCHAR(191) NULL,
    ADD COLUMN `usesGlasses` BOOLEAN NULL,
    ADD COLUMN `visionRemarks` VARCHAR(191) NULL,
    ADD COLUMN `visionType` VARCHAR(191) NULL;
