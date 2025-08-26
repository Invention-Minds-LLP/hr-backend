/*
  Warnings:

  - A unique constraint covering the columns `[clearanceCertificateUrl]` on the table `ResignationDocument` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `ResignationDocument_clearanceCertificateUrl_key` ON `ResignationDocument`(`clearanceCertificateUrl`);
