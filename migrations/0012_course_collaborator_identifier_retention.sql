-- 0012_course_collaborator_identifier_retention: preserve collaborator rows
-- when a retained login identifier is deleted.
--
-- 0011 gave recipient_identifier_id its own SET NULL foreign key, but its
-- composite owner-binding foreign key retained the default NO ACTION. The
-- composite check could therefore reject the delete before the single-column
-- action cleared the optional identifier. PostgreSQL's column-scoped SET NULL
-- keeps recipient_user_id intact while clearing only the retained identifier.

ALTER TABLE uais_course_collaborator_grants
  DROP CONSTRAINT IF EXISTS
    uais_course_collaborator_grants_recipient_identifier_owner_fk;

ALTER TABLE uais_course_collaborator_grants
  ADD CONSTRAINT uais_course_collaborator_grants_recipient_identifier_owner_fk
    FOREIGN KEY (recipient_user_id, recipient_identifier_id)
    REFERENCES uais_user_login_identifiers(user_id, identifier_id)
    ON DELETE SET NULL (recipient_identifier_id);

ALTER TABLE uais_course_collaborator_notification_outbox
  DROP CONSTRAINT IF EXISTS
    uais_course_collaborator_outbox_recipient_identifier_owner_fk;

ALTER TABLE uais_course_collaborator_notification_outbox
  ADD CONSTRAINT uais_course_collaborator_outbox_recipient_identifier_owner_fk
    FOREIGN KEY (recipient_user_id, recipient_identifier_id)
    REFERENCES uais_user_login_identifiers(user_id, identifier_id)
    ON DELETE SET NULL (recipient_identifier_id);
