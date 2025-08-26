-- AlterTable
ALTER TABLE `resignationdocument` ADD COLUMN `clearanceCertificateUrl` VARCHAR(191) NULL,
    ADD COLUMN `clearanceIssuedAt` DATETIME(3) NULL;
