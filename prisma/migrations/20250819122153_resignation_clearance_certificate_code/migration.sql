/*
  Warnings:

  - A unique constraint covering the columns `[clearanceCertificateCode]` on the table `ResignationDocument` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `ResignationDocument_clearanceCertificateUrl_key` ON `ResignationDocument`;

-- AlterTable
ALTER TABLE `ResignationDocument` ADD COLUMN `clearanceCertificateCode` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `ResignationDocument_clearanceCertificateCode_key` ON `ResignationDocument`(`clearanceCertificateCode`);
