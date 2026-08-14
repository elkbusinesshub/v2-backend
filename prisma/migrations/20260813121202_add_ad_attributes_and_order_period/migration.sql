-- AlterTable
ALTER TABLE `ad_orders` ADD COLUMN `depositAmount` DECIMAL(10, 2) NULL,
    ADD COLUMN `durationMonths` INTEGER NULL,
    ADD COLUMN `endAt` DATETIME(3) NULL,
    ADD COLUMN `quantity` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `ads` ADD COLUMN `attributes` JSON NULL,
    MODIFY `icon` VARCHAR(191) NOT NULL DEFAULT '🛍️';

-- AlterTable
ALTER TABLE `provider_requests` MODIFY `icon` VARCHAR(191) NOT NULL DEFAULT '🧹';
