-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `healthCheckReminderSent` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `healthCheckReminderYear` INTEGER NULL;
