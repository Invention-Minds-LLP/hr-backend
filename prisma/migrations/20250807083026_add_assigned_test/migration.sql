-- CreateTable
CREATE TABLE `AssignedTest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `testId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `assignedBy` INTEGER NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AssignedTest` ADD CONSTRAINT `AssignedTest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignedTest` ADD CONSTRAINT `AssignedTest_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `EvaluationTest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
