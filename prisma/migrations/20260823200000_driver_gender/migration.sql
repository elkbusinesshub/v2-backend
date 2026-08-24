-- Gender as printed on the licence. Nullable and purely additive: profiles
-- registered before this exist without it, and nothing is backfilled with a
-- guess. `verification` is what says whether a profile is complete.
ALTER TABLE `driver_profiles`
  ADD COLUMN `gender` ENUM('MALE', 'FEMALE', 'OTHER') NULL;
