-- Repair is priced by an admin per tile, by the hour and the technician,
-- the same way cleaning is.
CREATE TABLE `repair_prices` (
    `subCategory` VARCHAR(20) NOT NULL,
    `hourlyRate` DECIMAL(10, 2) NOT NULL,
    `partsFee` DECIMAL(10, 2) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`subCategory`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Starting prices so the screen has something to show before an admin sets
-- any. One row per tile the app draws.
INSERT INTO `repair_prices` (`subCategory`, `hourlyRate`, `partsFee`, `updatedAt`) VALUES
    ('ac', 149.00, 99.00, CURRENT_TIMESTAMP(3)),
    ('plm', 129.00, 79.00, CURRENT_TIMESTAMP(3)),
    ('elc', 129.00, 79.00, CURRENT_TIMESTAMP(3)),
    ('cpt', 139.00, 99.00, CURRENT_TIMESTAMP(3)),
    ('pnt', 119.00, 149.00, CURRENT_TIMESTAMP(3)),
    ('gen', 99.00, 49.00, CURRENT_TIMESTAMP(3));

-- Whether the technician was asked to bring the parts. Additive: existing
-- orders stay false.
ALTER TABLE `ad_orders` ADD COLUMN `withParts` BOOLEAN NOT NULL DEFAULT false;
