-- NOTE: Prisma keeps re-emitting an ALTER for `provider_requests.icon`'s emoji
-- default even after it has been applied (it round-trips the utf8mb4 default
-- differently on introspection). It is a no-op, and unrelated to this feature,
-- so it is left out to keep this migration purely additive.

-- CreateTable
CREATE TABLE `ads` (
    `id` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `categorySlug` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NOT NULL DEFAULT '🛍️',
    `price` DECIMAL(10, 2) NOT NULL,
    `priceUnit` VARCHAR(191) NOT NULL DEFAULT '',
    `locality` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'PAUSED') NOT NULL DEFAULT 'ACTIVE',
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `wishlistCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `ads_sellerId_idx`(`sellerId`),
    INDEX `ads_status_idx`(`status`),
    INDEX `ads_categorySlug_idx`(`categorySlug`),
    INDEX `ads_status_wishlistCount_viewCount_idx`(`status`, `wishlistCount`, `viewCount`),
    INDEX `ads_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ad_images` (
    `id` CHAR(36) NOT NULL,
    `adId` CHAR(36) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ad_images_adId_idx`(`adId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ad_views` (
    `id` CHAR(36) NOT NULL,
    `adId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ad_views_userId_idx`(`userId`),
    UNIQUE INDEX `ad_views_adId_userId_key`(`adId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ad_wishlists` (
    `id` CHAR(36) NOT NULL,
    `adId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ad_wishlists_userId_idx`(`userId`),
    UNIQUE INDEX `ad_wishlists_adId_userId_key`(`adId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ads` ADD CONSTRAINT `ads_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ad_images` ADD CONSTRAINT `ad_images_adId_fkey` FOREIGN KEY (`adId`) REFERENCES `ads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ad_views` ADD CONSTRAINT `ad_views_adId_fkey` FOREIGN KEY (`adId`) REFERENCES `ads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ad_views` ADD CONSTRAINT `ad_views_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ad_wishlists` ADD CONSTRAINT `ad_wishlists_adId_fkey` FOREIGN KEY (`adId`) REFERENCES `ads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ad_wishlists` ADD CONSTRAINT `ad_wishlists_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
