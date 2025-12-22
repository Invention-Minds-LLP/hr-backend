/*
  Warnings:

  - A unique constraint covering the columns `[employeeId,date]` on the table `Attendance` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE `AttendanceSyncLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `window` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `message` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Attendance_employeeId_date_key` ON `Attendance`(`employeeId`, `date`);
