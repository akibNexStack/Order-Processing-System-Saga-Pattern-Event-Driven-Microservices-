ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until timestamptz;
ALTER TABLE users ADD CONSTRAINT users_failed_login_attempts_valid CHECK (failed_login_attempts >= 0);
CREATE INDEX users_locked_until_idx ON users(locked_until) WHERE locked_until IS NOT NULL;

CREATE TABLE email_verification_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash varchar(64) NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX email_verification_tokens_user_idx ON email_verification_tokens(user_id);
CREATE TABLE password_reset_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash varchar(64) NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id);

CREATE TABLE auth_rate_limits (action varchar(40) NOT NULL, subject_hash varchar(64) NOT NULL, window_started_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, PRIMARY KEY (action, subject_hash, window_started_at), CHECK (attempts >= 0));
CREATE TABLE auth_audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL, event varchar(80) NOT NULL, ip_hash varchar(64), details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX auth_audit_logs_user_created_idx ON auth_audit_logs(user_id, created_at DESC);
CREATE INDEX auth_audit_logs_created_idx ON auth_audit_logs(created_at DESC);
