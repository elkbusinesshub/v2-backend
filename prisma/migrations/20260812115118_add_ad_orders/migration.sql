-- AlterTable
ALTER TABLE `ads` MODIFY `icon` VARCHAR(191) NOT NULL DEFAULT '🛍️';

-- AlterTable
ALTER TABLE `provider_requests` MODIFY `icon` VARCHAR(191) NOT NULL DEFAULT '🧹';

-- CreateTable
CREATE TABLE `ad_orders` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `adId` CHAR(36) NOT NULL,
    `buyerId` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `status` ENUM('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'NEW',
    `amount` DECIMAL(10, 2) NOT NULL,
    `serviceName` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `addressText` VARCHAR(191) NOT NULL,
    `contactPhone` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ad_orders_code_key`(`code`),
    INDEX `ad_orders_sellerId_status_idx`(`sellerId`, `status`),
    INDEX `ad_orders_buyerId_idx`(`buyerId`),
    INDEX `ad_orders_adId_idx`(`adId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ad_orders` ADD CONSTRAINT `ad_orders_adId_fkey` FOREIGN KEY (`adId`) REFERENCES `ads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ad_orders` ADD CONSTRAINT `ad_orders_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ad_orders` ADD CONSTRAINT `ad_orders_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
