-- CreateTable
CREATE TABLE `EntitlementPolicy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `leaveEntitlement` INTEGER NOT NULL DEFAULT 0,
    `wfhEntitlement` INTEGER NOT NULL DEFAULT 0,
    `permissionEntitlement` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
