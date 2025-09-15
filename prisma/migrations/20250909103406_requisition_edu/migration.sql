-- AlterTable
ALTER TABLE `manpowerrequisition` ADD COLUMN `eduOtherDetail` BOOLEAN NULL,
    MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'RAISED';
