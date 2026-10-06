-- Admins are given the modules they run: ELK Clean, Repair and Rental.
CREATE TABLE `admin_module_access` (
    `userId` CHAR(36) NOT NULL,
    `module` ENUM('CLEAN', 'REPAIR', 'RENTAL') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `module`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `admin_module_access` ADD CONSTRAINT `admin_module_access_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Admins from before modules existed keep everything they could do.
INSERT INTO `admin_module_access` (`userId`, `module`)
SELECT u.`id`, m.`module`
FROM `users` u
CROSS JOIN (SELECT 'CLEAN' AS `module` UNION ALL SELECT 'REPAIR' UNION ALL SELECT 'RENTAL') m
WHERE u.`userType` = 'ADMIN';
