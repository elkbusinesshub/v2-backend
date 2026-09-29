-- One role per account: users.userType. The `roles` JSON list goes away.
ALTER TABLE `users` MODIFY `userType` ENUM('USER', 'PROVIDER', 'ADMIN', 'PROFESSIONAL') NOT NULL DEFAULT 'USER';

-- Verified sellers held PROVIDER in `roles`. Admins and professionals keep
-- their type.
UPDATE `users` SET `userType` = 'PROVIDER'
WHERE `userType` = 'USER' AND JSON_CONTAINS(`roles`, '"PROVIDER"');

ALTER TABLE `users` DROP COLUMN `roles`;
