ALTER TABLE google_pending ADD COLUMN return_url TEXT;
ALTER TABLE google_pending ADD COLUMN state_claim INTEGER NOT NULL DEFAULT 0;
