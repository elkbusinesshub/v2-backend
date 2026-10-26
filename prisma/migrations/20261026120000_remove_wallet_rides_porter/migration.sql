-- Taxi, porter and the ELK Wallet are gone: payments are Razorpay or cash.
-- Drops their tables and the users' wallet balance. Irreversible: snapshot first.

-- DropForeignKey
ALTER TABLE `porter_bookings` DROP FOREIGN KEY `porter_bookings_userId_fkey`;

-- DropForeignKey
ALTER TABLE `porter_bookings` DROP FOREIGN KEY `porter_bookings_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `porter_bookings` DROP FOREIGN KEY `porter_bookings_driverId_fkey`;

-- DropForeignKey
ALTER TABLE `porter_booking_addons` DROP FOREIGN KEY `porter_booking_addons_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `porter_booking_addons` DROP FOREIGN KEY `porter_booking_addons_addonId_fkey`;

-- DropForeignKey
ALTER TABLE `ride_bookings` DROP FOREIGN KEY `ride_bookings_userId_fkey`;

-- DropForeignKey
ALTER TABLE `ride_bookings` DROP FOREIGN KEY `ride_bookings_rideTypeId_fkey`;

-- DropForeignKey
ALTER TABLE `ride_bookings` DROP FOREIGN KEY `ride_bookings_driverId_fkey`;

-- DropForeignKey
ALTER TABLE `driver_profiles` DROP FOREIGN KEY `driver_profiles_userId_fkey`;

-- DropForeignKey
ALTER TABLE `wallet_transactions` DROP FOREIGN KEY `wallet_transactions_userId_fkey`;

-- AlterTable
ALTER TABLE `users` DROP COLUMN `walletBalance`;

-- DropTable
DROP TABLE `porter_vehicles`;

-- DropTable
DROP TABLE `porter_addons`;

-- DropTable
DROP TABLE `porter_bookings`;

-- DropTable
DROP TABLE `porter_booking_addons`;

-- DropTable
DROP TABLE `ride_types`;

-- DropTable
DROP TABLE `ride_bookings`;

-- DropTable
DROP TABLE `driver_profiles`;

-- DropTable
DROP TABLE `wallet_transactions`;

