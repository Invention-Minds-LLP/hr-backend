-- AlterTable
ALTER TABLE `leaverequest` ADD COLUMN `declineReason` VARCHAR(191) NULL,
    ADD COLUMN `declinedBy` INTEGER NULL;
