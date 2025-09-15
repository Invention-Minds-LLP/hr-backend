/*
  Warnings:

  - A unique constraint covering the columns `[circularCode]` on the table `Announcement` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `announcement` ADD COLUMN `attachments` VARCHAR(191) NULL,
    ADD COLUMN `circularCode` VARCHAR(191) NULL,
    ADD COLUMN `isPinned` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `requireAck` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `type` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Announcement_circularCode_key` ON `Announcement`(`circularCode`);
