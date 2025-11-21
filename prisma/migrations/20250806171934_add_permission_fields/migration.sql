-- AlterTable
ALTER TABLE `PermissionRequest` ADD COLUMN `permissionType` ENUM('PERSONAL', 'OFFICIAL', 'MEDICAL', 'OTHER') NULL,
    ADD COLUMN `timing` ENUM('FULLDAY', 'HALFDAY', 'HOURLY') NULL;
