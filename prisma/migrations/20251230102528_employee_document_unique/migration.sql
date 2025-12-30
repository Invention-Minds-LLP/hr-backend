/*
  Warnings:

  - A unique constraint covering the columns `[employeeId,type]` on the table `Document` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `Document_employeeId_type_key` ON `Document`(`employeeId`, `type`);
