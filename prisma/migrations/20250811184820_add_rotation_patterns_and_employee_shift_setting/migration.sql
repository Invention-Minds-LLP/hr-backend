-- CreateTable
CREATE TABLE `ShiftRotationPattern` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `cycleDays` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftRotationItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `patternId` INTEGER NOT NULL,
    `dayIndex` INTEGER NOT NULL,
    `shiftId` INTEGER NOT NULL,

    UNIQUE INDEX `ShiftRotationItem_patternId_dayIndex_key`(`patternId`, `dayIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmployeeShiftSetting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `mode` ENUM('FIXED', 'ROTATIONAL') NOT NULL DEFAULT 'FIXED',
    `fixedShiftId` INTEGER NULL,
    `rotationPatternId` INTEGER NULL,
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmployeeShiftSetting_employeeId_key`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ShiftRotationItem` ADD CONSTRAINT `ShiftRotationItem_patternId_fkey` FOREIGN KEY (`patternId`) REFERENCES `ShiftRotationPattern`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftRotationItem` ADD CONSTRAINT `ShiftRotationItem_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeShiftSetting` ADD CONSTRAINT `EmployeeShiftSetting_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeShiftSetting` ADD CONSTRAINT `EmployeeShiftSetting_fixedShiftId_fkey` FOREIGN KEY (`fixedShiftId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeShiftSetting` ADD CONSTRAINT `EmployeeShiftSetting_rotationPatternId_fkey` FOREIGN KEY (`rotationPatternId`) REFERENCES `ShiftRotationPattern`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
