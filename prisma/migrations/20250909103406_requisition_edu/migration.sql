-- AlterTable
ALTER TABLE `ManpowerRequisition` ADD COLUMN `eduOtherDetail` BOOLEAN NULL,
    MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'RAISED';
