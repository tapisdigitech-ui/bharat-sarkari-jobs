-- Phase 2A: add the 'admin' staff role. Kept in its own migration because a new enum value
-- cannot be used in the same transaction that adds it.
alter type staff_role add value if not exists 'admin' after 'super_admin';
