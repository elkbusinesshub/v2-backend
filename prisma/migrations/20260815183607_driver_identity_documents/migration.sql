-- AlterTable
ALTER TABLE `driver_profiles` ADD COLUMN `dateOfBirth` DATE NULL,
    ADD COLUMN `fullName` VARCHAR(191) NULL,
    ADD COLUMN `licenceBackKey` VARCHAR(191) NULL,
    ADD COLUMN `licenceFrontKey` VARCHAR(191) NULL,
    ADD COLUMN `licenceNumber` VARCHAR(191) NULL,
    ADD COLUMN `vehicleDocKey` VARCHAR(191) NULL,
    ADD COLUMN `verification` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING';
