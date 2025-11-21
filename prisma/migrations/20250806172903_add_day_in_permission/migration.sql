/*
  Warnings:

  - Added the required column `day` to the `PermissionRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `PermissionRequest` ADD COLUMN `day` DATETIME(3) NOT NULL;
