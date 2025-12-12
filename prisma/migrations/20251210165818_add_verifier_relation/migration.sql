-- AddForeignKey
ALTER TABLE `ResignationClearance` ADD CONSTRAINT `ResignationClearance_verifierId_fkey` FOREIGN KEY (`verifierId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
