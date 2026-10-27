-- Admin and super admin accounts only run ELK; they never sell on it. Any
-- listing an admin or super admin account owns (the demo seed used to give
-- listings to the oldest account, which can be an admin) is deleted the way a
-- seller deletes one: hidden and paused, with any past orders kept.
UPDATE `ads` a
JOIN `users` u ON u.`id` = a.`sellerId`
SET a.`deletedAt` = CURRENT_TIMESTAMP(3), a.`status` = 'PAUSED'
WHERE a.`deletedAt` IS NULL
  AND u.`userType` IN ('ADMIN', 'SUPER_ADMIN');
