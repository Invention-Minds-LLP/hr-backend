-- CreateTable
CREATE TABLE `EmployeeLeaveBalance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `leaveTypeId` INTEGER NULL,
    `permissionType` ENUM('PERSONAL', 'OFFICIAL', 'MEDICAL', 'OTHER') NULL,
    `category` ENUM('LEAVE', 'PERMISSION') NOT NULL,
    `year` INTEGER NOT NULL,
    `totalAllowed` INTEGER NOT NULL DEFAULT 0,
    `used` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `EmployeeLeaveBalance_employeeId_leaveTypeId_permissionType_y_key`(`employeeId`, `leaveTypeId`, `permissionType`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmployeeLeaveBalance` ADD CONSTRAINT `EmployeeLeaveBalance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeLeaveBalance` ADD CONSTRAINT `EmployeeLeaveBalance_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `LeaveType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
