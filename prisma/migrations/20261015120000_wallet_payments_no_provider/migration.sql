-- Every user can sell, so PROVIDER is no longer a role.
UPDATE `users` SET `userType` = 'USER' WHERE `userType` = 'PROVIDER';
ALTER TABLE `users` MODIFY `userType` ENUM('USER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER';

-- How a booking or order was paid, so a wallet payment can be refunded.
ALTER TABLE `service_bookings` ADD COLUMN `paymentMethod` VARCHAR(20) NOT NULL DEFAULT 'card';
ALTER TABLE `ad_orders` ADD COLUMN `paymentMethod` VARCHAR(20) NULL;
