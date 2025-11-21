-- AlterTable
ALTER TABLE `Internship` ADD COLUMN `departmentId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Internship_departmentId_idx` ON `Internship`(`departmentId`);

-- AddForeignKey
ALTER TABLE `Internship` ADD CONSTRAINT `Internship_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
