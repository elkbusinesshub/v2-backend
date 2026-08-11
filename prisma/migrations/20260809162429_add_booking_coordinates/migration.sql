-- AlterTable
ALTER TABLE `ads` MODIFY `icon` VARCHAR(191) NOT NULL DEFAULT '🛍️';

-- AlterTable
ALTER TABLE `bookings` ADD COLUMN `lat` DOUBLE NULL,
    ADD COLUMN `lng` DOUBLE NULL;

-- AlterTable
ALTER TABLE `provider_requests` MODIFY `icon` VARCHAR(191) NOT NULL DEFAULT '🧹';
