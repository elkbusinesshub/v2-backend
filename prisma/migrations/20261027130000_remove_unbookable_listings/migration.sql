-- Listings created under categories the app has no screen for (e.g.
-- listing_stay, listing_tool_rental) before categories were checked. Deleted
-- the way a seller deletes one: hidden and paused, with any past orders kept.
UPDATE `ads`
SET `deletedAt` = CURRENT_TIMESTAMP(3), `status` = 'PAUSED'
WHERE `deletedAt` IS NULL
  AND `categorySlug` NOT IN ('cleaning', 'repairing', 'car_rental', 'elkstay');
