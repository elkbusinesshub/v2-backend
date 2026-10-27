-- "My business" was a placeholder the app gave sellers with no name, and it
-- showed to buyers as the seller's name. Use the seller's own name instead,
-- or nothing, so the app falls back to it.
UPDATE `provider_profiles` p
JOIN `users` u ON u.`id` = p.`userId`
SET p.`businessName` = COALESCE(u.`name`, '')
WHERE p.`businessName` = 'My business';
