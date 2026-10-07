CREATE TABLE IF NOT EXISTS destination_ledger (scope TEXT NOT NULL,generation TEXT NOT NULL,remote_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(scope,generation,remote_id));
