-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `inchargeId` INTEGER NULL;

-- AlterTable
ALTER TABLE `LeaveRequest` ADD COLUMN `inChargeDecidedAt` DATETIME(3) NULL,
    ADD COLUMN `inChargeDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `inChargeNote` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PermissionRequest` ADD COLUMN `inChargeDecidedAt` DATETIME(3) NULL,
    ADD COLUMN `inChargeDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE `ShiftApproval` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `shiftId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `inchargeDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `inchargeDecidedAt` DATETIME(3) NULL,
    `rmDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `rmDecidedAt` DATETIME(3) NULL,
    `hrDecision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `hrDecidedAt` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',

    UNIQUE INDEX `ShiftApproval_employeeId_shiftId_date_key`(`employeeId`, `shiftId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Employee_inchargeId_idx` ON `Employee`(`inchargeId`);

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_inchargeId_fkey` FOREIGN KEY (`inchargeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftApproval` ADD CONSTRAINT `ShiftApproval_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
