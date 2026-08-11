-- AlterTable
ALTER TABLE `ads` ADD COLUMN `lat` DOUBLE NULL,
    ADD COLUMN `lng` DOUBLE NULL,
    MODIFY `icon` VARCHAR(191) NOT NULL DEFAULT '🛍️';

-- AlterTable
ALTER TABLE `provider_requests` MODIFY `icon` VARCHAR(191) NOT NULL DEFAULT '🧹';

-- AlterTable
ALTER TABLE `rental_branches` ADD COLUMN `lat` DOUBLE NULL,
    ADD COLUMN `lng` DOUBLE NULL;
