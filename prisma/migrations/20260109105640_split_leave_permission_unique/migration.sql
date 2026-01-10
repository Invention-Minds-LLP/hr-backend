/*
  Warnings:

  - A unique constraint covering the columns `[employeeId,leaveTypeId,year]` on the table `EmployeeLeaveBalance` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[employeeId,permissionType,year]` on the table `EmployeeLeaveBalance` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `EmployeeLeaveBalance` DROP FOREIGN KEY `EmployeeLeaveBalance_employeeId_fkey`;

-- DropIndex
DROP INDEX `EmployeeLeaveBalance_employeeId_leaveTypeId_permissionType_y_key` ON `EmployeeLeaveBalance`;

-- CreateIndex
CREATE UNIQUE INDEX `EmployeeLeaveBalance_employeeId_leaveTypeId_year_key` ON `EmployeeLeaveBalance`(`employeeId`, `leaveTypeId`, `year`);

-- CreateIndex
CREATE UNIQUE INDEX `EmployeeLeaveBalance_employeeId_permissionType_year_key` ON `EmployeeLeaveBalance`(`employeeId`, `permissionType`, `year`);
