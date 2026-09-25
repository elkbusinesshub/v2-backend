-- Cleaning is priced by an admin per tile, by the hour and the professional,
-- instead of by each seller's listing price.
CREATE TABLE `cleaning_prices` (
    `subCategory` VARCHAR(20) NOT NULL,
    `hourlyRate` DECIMAL(10, 2) NOT NULL,
    `materialsFee` DECIMAL(10, 2) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`subCategory`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Starting prices so the screen has something to show before an admin sets
-- any. One row per tile the app draws.
INSERT INTO `cleaning_prices` (`subCategory`, `hourlyRate`, `materialsFee`, `updatedAt`) VALUES
    ('cln', 79.00, 30.00, CURRENT_TIMESTAMP(3)),
    ('deep', 99.00, 40.00, CURRENT_TIMESTAMP(3)),
    ('tnk', 89.00, 30.00, CURRENT_TIMESTAMP(3)),
    ('sof', 89.00, 30.00, CURRENT_TIMESTAMP(3)),
    ('crp', 89.00, 30.00, CURRENT_TIMESTAMP(3)),
    ('kit', 79.00, 30.00, CURRENT_TIMESTAMP(3)),
    ('bth', 79.00, 20.00, CURRENT_TIMESTAMP(3)),
    ('lndr', 59.00, 20.00, CURRENT_TIMESTAMP(3));

-- What the crew was booked for, so the seller turns up ready. Additive:
-- existing orders are not cleaning jobs priced this way and stay null/false.
ALTER TABLE `ad_orders`
    ADD COLUMN `hours` INTEGER NULL,
    ADD COLUMN `professionals` INTEGER NULL,
    ADD COLUMN `withMaterials` BOOLEAN NOT NULL DEFAULT false;

-- The details a pin cannot carry.
ALTER TABLE `addresses`
    ADD COLUMN `building` VARCHAR(191) NULL,
    ADD COLUMN `flatNumber` VARCHAR(191) NULL,
    ADD COLUMN `directions` TEXT NULL;
