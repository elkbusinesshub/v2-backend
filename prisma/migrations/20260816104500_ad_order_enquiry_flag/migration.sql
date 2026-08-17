-- Marks an order as a question rather than a purchase, so the buyer's second
-- tap of Chat reopens the same conversation instead of creating an empty one.
-- Purely additive: existing rows default to false, which is what they were.
ALTER TABLE `ad_orders` ADD COLUMN `isEnquiry` BOOLEAN NOT NULL DEFAULT false;

-- Looking up "this buyer's enquiry about this ad" on every tap of Chat.
CREATE INDEX `ad_orders_adId_buyerId_isEnquiry_idx` ON `ad_orders`(`adId`, `buyerId`, `isEnquiry`);
