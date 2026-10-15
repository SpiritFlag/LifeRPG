CREATE TABLE IF NOT EXISTS games (
 owner text PRIMARY KEY, revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0), privacy_epoch integer NOT NULL DEFAULT 0,
 world_sequence integer NOT NULL DEFAULT 0, started_at timestamptz, active_attempt text,
 state jsonb NOT NULL DEFAULT '{"level":1,"totalXp":0,"abilities":[],"entities":[]}', state_sources text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS records (
 id text PRIMARY KEY, owner text NOT NULL REFERENCES games(owner), kind text NOT NULL, version integer NOT NULL DEFAULT 1,
 payload jsonb, sources text[] NOT NULL DEFAULT '{}', important boolean NOT NULL DEFAULT false, deleted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_owner_kind ON records(owner,kind);
CREATE INDEX IF NOT EXISTS records_sources ON records USING gin(sources);
CREATE TABLE IF NOT EXISTS jobs (
 id text PRIMARY KEY, owner text NOT NULL REFERENCES games(owner), request_key text NOT NULL, fingerprint text, command jsonb,
 kind text NOT NULL, event_id text, status text NOT NULL CHECK(status IN ('waiting','running','committed','failed','interrupted','budget_blocked','deleted')),
 record_status text NOT NULL, result_id text, error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(owner,request_key)
);
CREATE INDEX IF NOT EXISTS jobs_waiting ON jobs(owner,created_at,id);
CREATE TABLE IF NOT EXISTS budgets(month text PRIMARY KEY, reserved numeric(12,6) NOT NULL DEFAULT 0 CHECK(reserved>=0), spent numeric(12,6) NOT NULL DEFAULT 0 CHECK(spent>=0));
CREATE TABLE IF NOT EXISTS attempts (
 id text PRIMARY KEY, job_id text NOT NULL REFERENCES jobs(id), owner text NOT NULL REFERENCES games(owner), base_revision integer NOT NULL, privacy_epoch integer NOT NULL,
 lease_until timestamptz NOT NULL, sources text[] NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', diagnostic jsonb, diagnostic_expires timestamptz,
 reservation numeric(12,6) NOT NULL, charge_status text NOT NULL CHECK(charge_status IN ('reserved','settled','unknown','not_called')), month text NOT NULL REFERENCES budgets(month), budget_keys text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_owner ON attempts(owner);
