-- CreateTable
CREATE TABLE `service_requests` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `kind` ENUM('CLEANING', 'RENTAL') NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `buyerId` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `staffId` CHAR(36) NULL,
    `district` VARCHAR(191) NULL,
    `serviceType` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NULL,
    `fulfilment` VARCHAR(191) NULL,
    `addressText` VARCHAR(191) NOT NULL,
    `lat` DECIMAL(10, 7) NOT NULL,
    `lng` DECIMAL(10, 7) NOT NULL,
    `shopAddress` VARCHAR(191) NULL,
    `shopLat` DECIMAL(10, 7) NULL,
    `shopLng` DECIMAL(10, 7) NULL,
    `note` TEXT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `feesAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `otpCode` VARCHAR(191) NULL,
    `otpAttempts` INTEGER NOT NULL DEFAULT 0,
    `excludedSellerIds` JSON NOT NULL,
    `retryOfId` CHAR(36) NULL,
    `paymentReference` VARCHAR(191) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `declinedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_requests_code_key`(`code`),
    INDEX `service_requests_buyerId_createdAt_idx`(`buyerId`, `createdAt`),
    INDEX `service_requests_sellerId_status_idx`(`sellerId`, `status`),
    INDEX `service_requests_staffId_status_idx`(`staffId`, `status`),
    INDEX `service_requests_kind_sellerId_status_scheduledAt_idx`(`kind`, `sellerId`, `status`, `scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partner_districts` (
    `id` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `district` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `partner_districts_district_idx`(`district`),
    UNIQUE INDEX `partner_districts_sellerId_district_key`(`sellerId`, `district`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cleaning_service_prices` (
    `id` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `serviceType` VARCHAR(191) NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cleaning_service_prices_serviceType_idx`(`serviceType`),
    UNIQUE INDEX `cleaning_service_prices_sellerId_serviceType_key`(`sellerId`, `serviceType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_shops` (
    `id` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `lat` DECIMAL(10, 7) NOT NULL,
    `lng` DECIMAL(10, 7) NOT NULL,
    `deliveryFee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rental_shops_sellerId_key`(`sellerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_vehicles` (
    `id` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `vehicleType` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `pricePerDay` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_vehicles_vehicleType_idx`(`vehicleType`),
    UNIQUE INDEX `rental_vehicles_sellerId_vehicleType_key`(`sellerId`, `vehicleType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_staff` (
    `id` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `staffUserId` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `seller_staff_staffUserId_idx`(`staffUserId`),
    UNIQUE INDEX `seller_staff_sellerId_staffUserId_key`(`sellerId`, `staffUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partner_districts` ADD CONSTRAINT `partner_districts_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cleaning_service_prices` ADD CONSTRAINT `cleaning_service_prices_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_shops` ADD CONSTRAINT `rental_shops_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_vehicles` ADD CONSTRAINT `rental_vehicles_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_staff` ADD CONSTRAINT `seller_staff_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_staff` ADD CONSTRAINT `seller_staff_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

