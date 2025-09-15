/*
  Warnings:

  - A unique constraint covering the columns `[employeeId,date]` on the table `OvertimeApproval` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `OvertimeApproval_employeeId_date_key` ON `OvertimeApproval`(`employeeId`, `date`);
