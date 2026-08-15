-- AlterTable
ALTER TABLE `porter_bookings` ADD COLUMN `driverId` CHAR(36) NULL,
    ADD COLUMN `driverName` VARCHAR(191) NULL,
    ADD COLUMN `otpCode` VARCHAR(191) NULL,
    ADD COLUMN `plateNumber` VARCHAR(191) NULL,
    ADD COLUMN `vehicleLabel` VARCHAR(191) NULL,
    MODIFY `status` ENUM('SEARCHING', 'NO_DRIVERS', 'CONFIRMED', 'PICKED_UP', 'DELIVERED', 'CANCELLED') NOT NULL;

-- AlterTable
ALTER TABLE `ride_bookings` ADD COLUMN `driverId` CHAR(36) NULL,
    MODIFY `status` ENUM('SEARCHING', 'NO_DRIVERS', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
    MODIFY `driverName` VARCHAR(191) NULL,
    MODIFY `vehicleLabel` VARCHAR(191) NULL,
    MODIFY `plateNumber` VARCHAR(191) NULL,
    MODIFY `otpCode` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `driver_profiles` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `service` ENUM('RIDE', 'PORTER') NOT NULL,
    `vehicleSlug` VARCHAR(191) NOT NULL,
    `vehicleLabel` VARCHAR(191) NOT NULL,
    `plateNumber` VARCHAR(191) NOT NULL,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `activeBookingId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `driver_profiles_service_vehicleSlug_isOnline_idx`(`service`, `vehicleSlug`, `isOnline`),
    UNIQUE INDEX `driver_profiles_userId_service_key`(`userId`, `service`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ride_bookings_driverId_idx` ON `ride_bookings`(`driverId`);

-- AddForeignKey
ALTER TABLE `porter_bookings` ADD CONSTRAINT `porter_bookings_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `driver_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_bookings` ADD CONSTRAINT `ride_bookings_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `driver_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_profiles` ADD CONSTRAINT `driver_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
