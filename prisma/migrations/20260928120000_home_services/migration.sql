-- ELK's own home services (cleaning, repair), run from the admin panel:
-- a service catalogue, service areas, professionals, promo codes, and
-- the bookings customers make against them.

-- CreateTable
CREATE TABLE `home_services` (
    `id` CHAR(36) NOT NULL,
    `vertical` ENUM('CLEANING', 'REPAIR') NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `minHours` INTEGER NOT NULL,
    `hourlyRate` DECIMAL(10, 2) NOT NULL,
    `extraProRate` DECIMAL(10, 2) NOT NULL,
    `materialsFee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `online` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `home_services_vertical_active_online_idx`(`vertical`, `active`, `online`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_locations` (
    `id` CHAR(36) NOT NULL,
    `area` VARCHAR(191) NOT NULL,
    `district` VARCHAR(191) NOT NULL,
    `pincode` VARCHAR(10) NOT NULL,
    `radiusKm` INTEGER NOT NULL DEFAULT 5,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `professionals` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `experienceYears` INTEGER NOT NULL DEFAULT 0,
    `skills` VARCHAR(191) NOT NULL DEFAULT '',
    `locationId` CHAR(36) NULL,
    `onDuty` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `professionals_locationId_idx`(`locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promo_codes` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `percent` INTEGER NOT NULL,
    `maxDiscount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `minOrder` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `validTill` DATE NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `promo_codes_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_bookings` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `serviceId` CHAR(36) NULL,
    `serviceName` VARCHAR(191) NOT NULL,
    `vertical` ENUM('CLEANING', 'REPAIR') NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `hours` INTEGER NOT NULL,
    `professionals` INTEGER NOT NULL,
    `withMaterials` BOOLEAN NOT NULL DEFAULT false,
    `scheduledDate` DATE NOT NULL,
    `timeSlot` VARCHAR(5) NOT NULL,
    `addressLabel` VARCHAR(191) NOT NULL,
    `addressText` VARCHAR(500) NOT NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `directions` TEXT NULL,
    `contactPhone` VARCHAR(20) NOT NULL,
    `locationId` CHAR(36) NULL,
    `professionalId` CHAR(36) NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `baseAmount` DECIMAL(10, 2) NOT NULL,
    `materialsAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `discountAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(10, 2) NOT NULL,
    `promoCode` VARCHAR(20) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_bookings_code_key`(`code`),
    INDEX `service_bookings_userId_idx`(`userId`),
    INDEX `service_bookings_status_scheduledDate_idx`(`status`, `scheduledDate`),
    INDEX `service_bookings_professionalId_idx`(`professionalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `professionals` ADD CONSTRAINT `professionals_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `service_locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_bookings` ADD CONSTRAINT `service_bookings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_bookings` ADD CONSTRAINT `service_bookings_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `home_services`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_bookings` ADD CONSTRAINT `service_bookings_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `service_locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_bookings` ADD CONSTRAINT `service_bookings_professionalId_fkey` FOREIGN KEY (`professionalId`) REFERENCES `professionals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Starting catalogue so the app has something to book before the admin
-- edits it. Prices are the ones in the admin panel's design; all live.
INSERT INTO `home_services` (`id`, `vertical`, `category`, `name`, `description`, `minHours`, `hourlyRate`, `extraProRate`, `materialsFee`, `active`, `online`, `updatedAt`) VALUES
    (UUID(), 'CLEANING', 'cln', 'Home cleaning', 'Regular cleaning of rooms, floors, dusting and surfaces.', 2, 299, 249, 99, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'CLEANING', 'bth', 'Bathroom deep clean', 'Descaling tiles, fittings, mirrors and floor scrubbing.', 2, 349, 299, 149, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'CLEANING', 'kit', 'Kitchen deep clean', 'Degreasing counters, cabinets, chimney exterior and sink.', 3, 399, 349, 199, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'CLEANING', 'deep', 'Full home deep clean', 'Top-to-bottom cleaning for move-in, move-out or festivals.', 5, 449, 399, 299, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'CLEANING', 'sof', 'Sofa shampooing', 'Wet shampoo and extraction for fabric sofas, up to 5 seats.', 2, 399, 299, 0, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'CLEANING', 'lndr', 'Laundry & ironing', 'Wash, dry and iron at home. Up to 30 garments per visit.', 1, 199, 149, 0, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'REPAIR', 'ac', 'AC service', 'Filter and coil cleaning, gas check and cooling test.', 1, 449, 349, 299, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'REPAIR', 'plm', 'Plumbing', 'Leaks, taps, flush tanks, blocked drains and pipe fittings.', 1, 299, 249, 199, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'REPAIR', 'elc', 'Electrical', 'Switches, sockets, fans, lights and wiring faults.', 1, 299, 249, 149, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'REPAIR', 'cpt', 'Carpentry', 'Doors, hinges, locks, shelves and furniture repair.', 2, 349, 299, 249, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'REPAIR', 'pnt', 'Painting', 'Touch-ups, single walls and small rooms, with surface prep.', 4, 399, 349, 499, true, true, CURRENT_TIMESTAMP(3)),
    (UUID(), 'REPAIR', 'gen', 'Handyman', 'Small fixes around the house: mounting, fitting, assembly.', 1, 249, 199, 99, true, true, CURRENT_TIMESTAMP(3));
