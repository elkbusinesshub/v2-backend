/*
  Warnings:

  - You are about to drop the column `bookingId` on the `chat_messages` table. All the data in the column will be lost.
  - You are about to drop the column `avgPerJob` on the `provider_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `completedJobs` on the `provider_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `rating` on the `provider_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `reviewCount` on the `provider_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `totalEarnings` on the `provider_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `bookingId` on the `reviews` table. All the data in the column will be lost.
  - You are about to drop the `bookings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `clean_booking_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `clean_bookings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `clean_categories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `clean_offers` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `clean_promos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `clean_services` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `provider_requests` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rental_booking_extras` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rental_bookings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rental_branches` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rental_cars` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rental_extras` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rental_promos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `repair_booking_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `repair_bookings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `repair_categories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `repair_offers` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `repair_promos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `repair_services` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `service_categories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `services` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stay_amenities` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stay_bookings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stay_coupons` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stay_favorites` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stay_room_options` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stays` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `adOrderId` on table `chat_messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `adOrderId` on table `reviews` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `bookings` DROP FOREIGN KEY `bookings_serviceId_fkey`;

-- DropForeignKey
ALTER TABLE `bookings` DROP FOREIGN KEY `bookings_userId_fkey`;

-- DropForeignKey
ALTER TABLE `chat_messages` DROP FOREIGN KEY `chat_messages_adOrderId_fkey`;

-- DropForeignKey
ALTER TABLE `chat_messages` DROP FOREIGN KEY `chat_messages_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `clean_booking_items` DROP FOREIGN KEY `clean_booking_items_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `clean_booking_items` DROP FOREIGN KEY `clean_booking_items_serviceId_fkey`;

-- DropForeignKey
ALTER TABLE `clean_bookings` DROP FOREIGN KEY `clean_bookings_userId_fkey`;

-- DropForeignKey
ALTER TABLE `clean_services` DROP FOREIGN KEY `clean_services_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `provider_requests` DROP FOREIGN KEY `provider_requests_providerId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_booking_extras` DROP FOREIGN KEY `rental_booking_extras_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_booking_extras` DROP FOREIGN KEY `rental_booking_extras_extraId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_bookings` DROP FOREIGN KEY `rental_bookings_branchId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_bookings` DROP FOREIGN KEY `rental_bookings_carId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_bookings` DROP FOREIGN KEY `rental_bookings_userId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_cars` DROP FOREIGN KEY `rental_cars_providerId_fkey`;

-- DropForeignKey
ALTER TABLE `repair_booking_items` DROP FOREIGN KEY `repair_booking_items_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `repair_booking_items` DROP FOREIGN KEY `repair_booking_items_serviceId_fkey`;

-- DropForeignKey
ALTER TABLE `repair_bookings` DROP FOREIGN KEY `repair_bookings_userId_fkey`;

-- DropForeignKey
ALTER TABLE `repair_services` DROP FOREIGN KEY `repair_services_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `reviews` DROP FOREIGN KEY `reviews_adOrderId_fkey`;

-- DropForeignKey
ALTER TABLE `reviews` DROP FOREIGN KEY `reviews_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `services` DROP FOREIGN KEY `services_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `stay_amenities` DROP FOREIGN KEY `stay_amenities_stayId_fkey`;

-- DropForeignKey
ALTER TABLE `stay_bookings` DROP FOREIGN KEY `stay_bookings_roomOptionId_fkey`;

-- DropForeignKey
ALTER TABLE `stay_bookings` DROP FOREIGN KEY `stay_bookings_stayId_fkey`;

-- DropForeignKey
ALTER TABLE `stay_bookings` DROP FOREIGN KEY `stay_bookings_userId_fkey`;

-- DropForeignKey
ALTER TABLE `stay_favorites` DROP FOREIGN KEY `stay_favorites_stayId_fkey`;

-- DropForeignKey
ALTER TABLE `stay_favorites` DROP FOREIGN KEY `stay_favorites_userId_fkey`;

-- DropForeignKey
ALTER TABLE `stay_room_options` DROP FOREIGN KEY `stay_room_options_stayId_fkey`;

-- DropForeignKey
ALTER TABLE `stays` DROP FOREIGN KEY `stays_providerId_fkey`;

-- DropIndex
DROP INDEX `chat_messages_bookingId_idx` ON `chat_messages`;

-- DropIndex
DROP INDEX `reviews_bookingId_key` ON `reviews`;

-- AlterTable
ALTER TABLE `ad_orders` ADD COLUMN `lat` DECIMAL(10, 7) NULL,
    ADD COLUMN `lng` DECIMAL(10, 7) NULL;

-- AlterTable
ALTER TABLE `ads` ADD COLUMN `ratingAverage` DECIMAL(2, 1) NOT NULL DEFAULT 0,
    ADD COLUMN `ratingCount` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `chat_messages` DROP COLUMN `bookingId`,
    MODIFY `adOrderId` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `provider_profiles` DROP COLUMN `avgPerJob`,
    DROP COLUMN `completedJobs`,
    DROP COLUMN `rating`,
    DROP COLUMN `reviewCount`,
    DROP COLUMN `totalEarnings`;

-- AlterTable
ALTER TABLE `reviews` DROP COLUMN `bookingId`,
    MODIFY `adOrderId` CHAR(36) NOT NULL;

-- DropTable
DROP TABLE `bookings`;

-- DropTable
DROP TABLE `clean_booking_items`;

-- DropTable
DROP TABLE `clean_bookings`;

-- DropTable
DROP TABLE `clean_categories`;

-- DropTable
DROP TABLE `clean_offers`;

-- DropTable
DROP TABLE `clean_promos`;

-- DropTable
DROP TABLE `clean_services`;

-- DropTable
DROP TABLE `provider_requests`;

-- DropTable
DROP TABLE `rental_booking_extras`;

-- DropTable
DROP TABLE `rental_bookings`;

-- DropTable
DROP TABLE `rental_branches`;

-- DropTable
DROP TABLE `rental_cars`;

-- DropTable
DROP TABLE `rental_extras`;

-- DropTable
DROP TABLE `rental_promos`;

-- DropTable
DROP TABLE `repair_booking_items`;

-- DropTable
DROP TABLE `repair_bookings`;

-- DropTable
DROP TABLE `repair_categories`;

-- DropTable
DROP TABLE `repair_offers`;

-- DropTable
DROP TABLE `repair_promos`;

-- DropTable
DROP TABLE `repair_services`;

-- DropTable
DROP TABLE `service_categories`;

-- DropTable
DROP TABLE `services`;

-- DropTable
DROP TABLE `stay_amenities`;

-- DropTable
DROP TABLE `stay_bookings`;

-- DropTable
DROP TABLE `stay_coupons`;

-- DropTable
DROP TABLE `stay_favorites`;

-- DropTable
DROP TABLE `stay_room_options`;

-- DropTable
DROP TABLE `stays`;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_adOrderId_fkey` FOREIGN KEY (`adOrderId`) REFERENCES `ad_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_adOrderId_fkey` FOREIGN KEY (`adOrderId`) REFERENCES `ad_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
