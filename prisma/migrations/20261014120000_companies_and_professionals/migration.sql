-- Companies (ADMIN accounts) own their areas, professionals and bookings.
-- Professionals are no longer app accounts: they are a company's people,
-- approved by the super admin and told about jobs by WhatsApp.

-- 1. Bookings keep the professional's name and phone as history.
ALTER TABLE `service_bookings`
    ADD COLUMN `companyId` CHAR(36) NULL,
    ADD COLUMN `professionalName` VARCHAR(191) NULL,
    ADD COLUMN `professionalPhone` VARCHAR(20) NULL;

UPDATE `service_bookings` b
JOIN `professionals` p ON p.`id` = b.`professionalId`
SET b.`professionalName` = p.`name`, b.`professionalPhone` = p.`phone`;

-- 2. Areas belong to a company. Existing areas go to the oldest admin, so
--    the bookings in them keep a company.
ALTER TABLE `service_locations` ADD COLUMN `companyId` CHAR(36) NULL;
CREATE INDEX `service_locations_companyId_idx` ON `service_locations`(`companyId`);
ALTER TABLE `service_locations` ADD CONSTRAINT `service_locations_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE `service_locations`
SET `companyId` = (SELECT `id` FROM `users` WHERE `userType` = 'ADMIN' AND `deletedAt` IS NULL ORDER BY `createdAt` LIMIT 1);

UPDATE `service_bookings` b
JOIN `service_locations` l ON l.`id` = b.`locationId`
SET b.`companyId` = l.`companyId`;

CREATE INDEX `service_bookings_companyId_status_idx` ON `service_bookings`(`companyId`, `status`);
ALTER TABLE `service_bookings` ADD CONSTRAINT `service_bookings_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. The old professionals (app accounts, no company) are removed.
ALTER TABLE `service_bookings` DROP FOREIGN KEY `service_bookings_professionalId_fkey`;
UPDATE `service_bookings` SET `professionalId` = NULL;
DROP TABLE `professionals`;

CREATE TABLE `professionals` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `email` VARCHAR(190) NOT NULL,
    `experienceYears` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `decidedById` CHAR(36) NULL,
    `decidedAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `professionals_companyId_status_idx`(`companyId`, `status`),
    INDEX `professionals_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `professionals` ADD CONSTRAINT `professionals_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `professionals` ADD CONSTRAINT `professionals_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `service_bookings` ADD CONSTRAINT `service_bookings_professionalId_fkey` FOREIGN KEY (`professionalId`) REFERENCES `professionals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `professional_categories` (
    `professionalId` CHAR(36) NOT NULL,
    `category` VARCHAR(20) NOT NULL,

    INDEX `professional_categories_category_idx`(`category`),
    PRIMARY KEY (`professionalId`, `category`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `professional_categories` ADD CONSTRAINT `professional_categories_professionalId_fkey` FOREIGN KEY (`professionalId`) REFERENCES `professionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Every WhatsApp sent about a job.
CREATE TABLE `whatsapp_messages` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `professionalId` CHAR(36) NULL,
    `toPhone` VARCHAR(20) NOT NULL,
    `template` VARCHAR(100) NOT NULL,
    `status` ENUM('SENT', 'FAILED', 'SKIPPED') NOT NULL,
    `providerMessageId` VARCHAR(200) NULL,
    `error` TEXT NULL,
    `sentById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsapp_messages_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `whatsapp_messages` ADD CONSTRAINT `whatsapp_messages_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `service_bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `whatsapp_messages` ADD CONSTRAINT `whatsapp_messages_professionalId_fkey` FOREIGN KEY (`professionalId`) REFERENCES `professionals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. PROFESSIONAL is no longer a role.
UPDATE `users` SET `userType` = 'USER' WHERE `userType` = 'PROFESSIONAL';
ALTER TABLE `users` MODIFY `userType` ENUM('USER', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER';
