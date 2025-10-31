-- AlterTable
ALTER TABLE `employee` ADD COLUMN `employeeType` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `qualification` ADD COLUMN `degreeName` VARCHAR(191) NULL,
    ADD COLUMN `grade` VARCHAR(191) NULL;
