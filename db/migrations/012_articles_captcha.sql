ALTER TABLE scheduled_posts ADD COLUMN article jsonb;
ALTER TABLE captcha_pending ADD COLUMN restriction_until integer;
