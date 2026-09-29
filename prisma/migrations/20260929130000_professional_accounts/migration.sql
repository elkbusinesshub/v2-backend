-- Professionals sign in to the app with their phone and get their own screens.
ALTER TABLE `users` MODIFY `userType` ENUM('USER', 'ADMIN', 'PROFESSIONAL') NOT NULL DEFAULT 'USER';

ALTER TABLE `professionals` ADD COLUMN `userId` CHAR(36) NULL;
CREATE UNIQUE INDEX `professionals_userId_key` ON `professionals`(`userId`);
ALTER TABLE `professionals` ADD CONSTRAINT `professionals_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Link the professionals already added. The panel stores "+91 98765 43210";
-- accounts hold "+919876543210". A phone shared by two professionals is
-- left unlinked: the admin fixes it by editing one of them.
INSERT INTO `users` (`id`, `phone`, `name`, `roles`, `userType`, `updatedAt`)
SELECT UUID(), uq.ph, uq.name, '["USER"]', 'PROFESSIONAL', CURRENT_TIMESTAMP(3)
FROM (
    SELECT REPLACE(`phone`, ' ', '') AS ph, MIN(`name`) AS name
    FROM `professionals` GROUP BY ph HAVING COUNT(*) = 1
) uq
WHERE NOT EXISTS (SELECT 1 FROM `users` u WHERE u.`phone` = uq.ph);

UPDATE `professionals` p
JOIN (
    SELECT REPLACE(`phone`, ' ', '') AS ph FROM `professionals` GROUP BY ph HAVING COUNT(*) = 1
) uq ON uq.ph = REPLACE(p.`phone`, ' ', '')
JOIN `users` u ON u.`phone` = uq.ph
SET p.`userId` = u.`id`;

UPDATE `users` u
JOIN `professionals` p ON p.`userId` = u.`id`
SET u.`userType` = 'PROFESSIONAL'
WHERE u.`userType` = 'USER';
