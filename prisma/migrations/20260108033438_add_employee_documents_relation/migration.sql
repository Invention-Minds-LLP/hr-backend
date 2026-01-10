-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
