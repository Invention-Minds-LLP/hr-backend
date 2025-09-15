-- DropForeignKey
ALTER TABLE `manpowerrequisition` DROP FOREIGN KEY `ManpowerRequisition_jobId_fkey`;

-- AlterTable
ALTER TABLE `manpowerrequisition` MODIFY `jobId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `ManpowerRequisition` ADD CONSTRAINT `ManpowerRequisition_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
