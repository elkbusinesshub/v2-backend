-- DropForeignKey
ALTER TABLE `chat_messages` DROP FOREIGN KEY `chat_messages_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `reviews` DROP FOREIGN KEY `reviews_bookingId_fkey`;

-- AlterTable
ALTER TABLE `chat_messages` ADD COLUMN `adOrderId` CHAR(36) NULL,
    MODIFY `bookingId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `reviews` ADD COLUMN `adOrderId` CHAR(36) NULL,
    MODIFY `bookingId` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `chat_messages_adOrderId_idx` ON `chat_messages`(`adOrderId`);

-- CreateIndex
CREATE UNIQUE INDEX `reviews_adOrderId_key` ON `reviews`(`adOrderId`);

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_adOrderId_fkey` FOREIGN KEY (`adOrderId`) REFERENCES `ad_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_adOrderId_fkey` FOREIGN KEY (`adOrderId`) REFERENCES `ad_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
