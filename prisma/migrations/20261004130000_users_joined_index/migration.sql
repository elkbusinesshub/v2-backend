-- The super admin's Users tab lists accounts newest first.
CREATE INDEX `users_deletedAt_createdAt_idx` ON `users`(`deletedAt`, `createdAt`);
