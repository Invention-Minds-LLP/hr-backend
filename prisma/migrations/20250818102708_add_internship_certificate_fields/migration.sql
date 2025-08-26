/*
  Warnings:

  - A unique constraint covering the columns `[certificateCode]` on the table `Internship` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `internship` ADD COLUMN `certificateCode` VARCHAR(191) NULL,
    ADD COLUMN `certificateIssuedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Internship_certificateCode_key` ON `Internship`(`certificateCode`);
