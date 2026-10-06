-- A super admin approves the admin's new services and price/duration changes.
ALTER TABLE `users` MODIFY `userType` ENUM('USER', 'PROVIDER', 'ADMIN', 'PROFESSIONAL', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER';

-- Services already in the app stay in the app.
ALTER TABLE `home_services` ADD COLUMN `approved` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `service_change_requests` (
    `id` CHAR(36) NOT NULL,
    `kind` ENUM('NEW_SERVICE', 'PRICE_CHANGE') NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `serviceId` CHAR(36) NULL,
    `openFor` CHAR(36) NULL,
    `before` JSON NULL,
    `requested` JSON NOT NULL,
    `requestedById` CHAR(36) NOT NULL,
    `decidedById` CHAR(36) NULL,
    `decidedAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_change_requests_openFor_key`(`openFor`),
    INDEX `service_change_requests_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `service_change_requests_decidedAt_idx`(`decidedAt`),
    INDEX `service_change_requests_serviceId_idx`(`serviceId`),
    INDEX `service_change_requests_requestedById_idx`(`requestedById`),
    INDEX `service_change_requests_decidedById_idx`(`decidedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `service_change_requests` ADD CONSTRAINT `service_change_requests_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `home_services`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `service_change_requests` ADD CONSTRAINT `service_change_requests_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `service_change_requests` ADD CONSTRAINT `service_change_requests_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
