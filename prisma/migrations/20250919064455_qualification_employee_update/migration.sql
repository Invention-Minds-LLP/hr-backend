-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `employeeType` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Qualification` ADD COLUMN `degreeName` VARCHAR(191) NULL,
    ADD COLUMN `grade` VARCHAR(191) NULL;
