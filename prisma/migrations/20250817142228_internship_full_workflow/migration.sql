/*
  Warnings:

  - Added the required column `candidateName` to the `Internship` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `Internship` DROP FOREIGN KEY `Internship_employeeId_fkey`;

-- DropIndex
DROP INDEX `Internship_employeeId_fkey` ON `Internship`;

-- AlterTable
ALTER TABLE `Internship` ADD COLUMN `candidateName` VARCHAR(191) NOT NULL,
    ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `stipend` INTEGER NULL,
    ADD COLUMN `title` VARCHAR(191) NULL,
    MODIFY `employeeId` INTEGER NULL,
    MODIFY `status` ENUM('DRAFT', 'OFFERED', 'ACTIVE', 'COMPLETED', 'CONVERTED', 'DROPPED') NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX `Internship_mentorId_idx` ON `Internship`(`mentorId`);

-- AddForeignKey
ALTER TABLE `Internship` ADD CONSTRAINT `Internship_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
