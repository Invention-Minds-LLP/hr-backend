-- CreateTable
CREATE TABLE `LateLoginLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `shiftStart` DATETIME(3) NOT NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `lateMinutes` INTEGER NOT NULL,
    `source` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LateLoginLog_employeeId_idx`(`employeeId`),
    INDEX `LateLoginLog_date_idx`(`date`),
    UNIQUE INDEX `LateLoginLog_employeeId_date_key`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LateLoginLog` ADD CONSTRAINT `LateLoginLog_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
