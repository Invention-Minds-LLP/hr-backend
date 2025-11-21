-- AlterTable
ALTER TABLE `Candidate` ADD COLUMN `lastLogin` DATETIME(3) NULL,
    ADD COLUMN `passwordHash` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `CandidateLoginHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `success` BOOLEAN NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CandidateLoginHistory` ADD CONSTRAINT `CandidateLoginHistory_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
