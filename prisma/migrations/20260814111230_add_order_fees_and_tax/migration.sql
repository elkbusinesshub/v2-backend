-- AlterTable
ALTER TABLE `ad_orders` ADD COLUMN `feesAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `taxAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `ads` ALTER COLUMN `icon` DROP DEFAULT;

-- AlterTable
ALTER TABLE `provider_requests` ALTER COLUMN `icon` DROP DEFAULT;
