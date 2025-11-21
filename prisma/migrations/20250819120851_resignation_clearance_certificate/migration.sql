-- AlterTable
ALTER TABLE `ResignationDocument` ADD COLUMN `clearanceCertificateUrl` VARCHAR(191) NULL,
    ADD COLUMN `clearanceIssuedAt` DATETIME(3) NULL;
