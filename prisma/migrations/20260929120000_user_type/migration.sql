-- users.userType replaces the ADMIN_PHONES allowlist as the source of the ADMIN role.
ALTER TABLE `users` ADD COLUMN `userType` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER';

-- Existing admins (granted ADMIN in `roles` by the old allowlist) keep admin.
UPDATE `users` SET `userType` = 'ADMIN' WHERE JSON_CONTAINS(`roles`, '"ADMIN"');

-- ADMIN now comes from userType alone, so take it out of `roles`.
UPDATE `users`
SET `roles` = JSON_REMOVE(`roles`, JSON_UNQUOTE(JSON_SEARCH(`roles`, 'one', 'ADMIN')))
WHERE JSON_CONTAINS(`roles`, '"ADMIN"');

-- The owner's admin accounts. Created if the phone has never signed in,
-- promoted if it has.
INSERT INTO `users` (`id`, `phone`, `name`, `roles`, `userType`, `updatedAt`) VALUES
    (UUID(), '+919562461531', NULL, '["USER"]', 'ADMIN', CURRENT_TIMESTAMP(3)),
    (UUID(), '+917034996847', NULL, '["USER"]', 'ADMIN', CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `userType` = 'ADMIN';
