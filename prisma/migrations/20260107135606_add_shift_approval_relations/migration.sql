-- CreateIndex
CREATE INDEX `ShiftApproval_fixedShiftId_idx` ON `ShiftApproval`(`fixedShiftId`);

-- CreateIndex
CREATE INDEX `ShiftApproval_patternId_idx` ON `ShiftApproval`(`patternId`);

-- CreateIndex
CREATE INDEX `ShiftApproval_requestedBy_idx` ON `ShiftApproval`(`requestedBy`);

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_patternId_fkey` FOREIGN KEY (`patternId`) REFERENCES `ShiftRotationPattern`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_fixedShiftId_fkey` FOREIGN KEY (`fixedShiftId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_requestedBy_fkey` FOREIGN KEY (`requestedBy`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
