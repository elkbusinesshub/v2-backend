-- Chat moves from orders to accounts: a conversation is between two people,
-- not attached to a job. Existing messages are migrated, not discarded.

-- 1. The conversation itself. The pair is stored sorted so one row is found
--    from either side, and the unique key makes a duplicate impossible.
CREATE TABLE `chat_threads` (
  `id`            CHAR(36) NOT NULL,
  `userAId`       CHAR(36) NOT NULL,
  `userBId`       CHAR(36) NOT NULL,
  `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `chat_threads_userAId_userBId_key`(`userAId`, `userBId`),
  INDEX `chat_threads_userAId_lastMessageAt_idx`(`userAId`, `lastMessageAt`),
  INDEX `chat_threads_userBId_lastMessageAt_idx`(`userBId`, `lastMessageAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `chat_threads`
  ADD CONSTRAINT `chat_threads_userAId_fkey` FOREIGN KEY (`userAId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `chat_threads_userBId_fkey` FOREIGN KEY (`userBId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. One thread per distinct pair that has ever exchanged a message. LEAST /
--    GREATEST give the sorted pair, so the two directions collapse into one.
INSERT INTO `chat_threads` (`id`, `userAId`, `userBId`, `lastMessageAt`, `createdAt`, `updatedAt`)
SELECT
  UUID(),
  LEAST(o.`buyerId`, o.`sellerId`),
  GREATEST(o.`buyerId`, o.`sellerId`),
  MAX(m.`createdAt`),
  MIN(m.`createdAt`),
  NOW(3)
FROM `chat_messages` m
JOIN `ad_orders` o ON o.`id` = m.`adOrderId`
GROUP BY LEAST(o.`buyerId`, o.`sellerId`), GREATEST(o.`buyerId`, o.`sellerId`);

-- 3. New columns, nullable while they are backfilled.
ALTER TABLE `chat_messages`
  ADD COLUMN `threadId` CHAR(36) NULL,
  ADD COLUMN `senderId` CHAR(36) NULL,
  ADD COLUMN `readAt`   DATETIME(3) NULL;

-- 4. Who actually wrote each message. `fromProvider` recorded a role, so the
--    sender is the order's seller when it is true and the buyer when false.
UPDATE `chat_messages` m
JOIN `ad_orders` o ON o.`id` = m.`adOrderId`
JOIN `chat_threads` t
  ON t.`userAId` = LEAST(o.`buyerId`, o.`sellerId`)
 AND t.`userBId` = GREATEST(o.`buyerId`, o.`sellerId`)
SET
  m.`threadId` = t.`id`,
  m.`senderId` = IF(m.`fromProvider`, o.`sellerId`, o.`buyerId`);

-- 5. Anything that failed to map has no conversation to belong to. There
--    should be none: adOrderId was NOT NULL with a foreign key.
DELETE FROM `chat_messages` WHERE `threadId` IS NULL;

ALTER TABLE `chat_messages`
  MODIFY COLUMN `threadId` CHAR(36) NOT NULL,
  MODIFY COLUMN `senderId` CHAR(36) NOT NULL;

-- 6. `adOrderId` is kept, nullable, as the only record of what an old
--    conversation was about. `fromProvider` is superseded by `senderId` and
--    is left in place rather than dropped; neither is read any more.
ALTER TABLE `chat_messages` DROP FOREIGN KEY `chat_messages_adOrderId_fkey`;
ALTER TABLE `chat_messages`
  MODIFY COLUMN `adOrderId` CHAR(36) NULL,
  MODIFY COLUMN `fromProvider` BOOLEAN NULL;
ALTER TABLE `chat_messages`
  ADD CONSTRAINT `chat_messages_adOrderId_fkey` FOREIGN KEY (`adOrderId`) REFERENCES `ad_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The adOrderId index stays exactly as it was: its foreign key still needs
-- it, and dropping it mid-migration fails with errno 1553.
CREATE INDEX `chat_messages_threadId_createdAt_idx` ON `chat_messages`(`threadId`, `createdAt`);
CREATE INDEX `chat_messages_threadId_senderId_readAt_idx` ON `chat_messages`(`threadId`, `senderId`, `readAt`);

ALTER TABLE `chat_messages`
  ADD CONSTRAINT `chat_messages_threadId_fkey` FOREIGN KEY (`threadId`) REFERENCES `chat_threads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `chat_messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
