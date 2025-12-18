-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `designationId` INTEGER NULL,
    MODIFY `designation` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Designation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Designation_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_designationId_fkey` FOREIGN KEY (`designationId`) REFERENCES `Designation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
