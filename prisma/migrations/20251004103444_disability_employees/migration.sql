/*
  Warnings:

  - You are about to drop the column `disabilities` on the `employee` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Employee` DROP COLUMN `disabilities`,
    ADD COLUMN `disabilityDescription` VARCHAR(191) NULL,
    ADD COLUMN `disabilityProofFile` VARCHAR(191) NULL,
    ADD COLUMN `disabilityProofFileName` VARCHAR(191) NULL,
    ADD COLUMN `disabilityProofUrl` VARCHAR(191) NULL,
    ADD COLUMN `disabilityType` VARCHAR(191) NULL,
    ADD COLUMN `hasDisability` BOOLEAN NULL;
