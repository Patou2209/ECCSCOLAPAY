-- ============================================================================
-- Migration 0009 : Répartition des quotas (ECC / État / École)
--  - quota_configs     : montants des quotas par groupe de frais x trimestre
--  - quota_settlements : règlements effectués (bouton « Régler le quota »)
--  - cash_book_entries.quota_settlement_id : lie la ligne de caisse au règlement
-- ============================================================================
CREATE TABLE IF NOT EXISTS quota_configs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id          INTEGER NOT NULL,
  trimester_id       INTEGER NOT NULL,
  group_key          TEXT NOT NULL,                 -- clé du groupe de frais (voir utils/feeGroups.ts)
  ecole              REAL NOT NULL DEFAULT 0 CHECK(ecole >= 0),              -- frais de construction (retenus par l'école)
  ecc                REAL NOT NULL DEFAULT 0 CHECK(ecc >= 0),                -- frais de l'ECC
  fonctionnement     REAL NOT NULL DEFAULT 0 CHECK(fonctionnement >= 0),     -- État : frais de fonctionnement
  appui_enseignants  REAL NOT NULL DEFAULT 0 CHECK(appui_enseignants >= 0),  -- État : frais de l'appui aux enseignants
  pct_bureaux        REAL NOT NULL DEFAULT 7 CHECK(pct_bureaux >= 0 AND pct_bureaux <= 100), -- % de l'appui -> bureaux de gestion (le reste -> enseignants debout)
  updated_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (trimester_id) REFERENCES trimesters(id) ON DELETE CASCADE,
  UNIQUE(school_id, trimester_id, group_key)
);

CREATE TABLE IF NOT EXISTS quota_settlements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL,
  school_year_id  INTEGER NOT NULL,
  trimester_id    INTEGER NOT NULL,
  quota_type      TEXT NOT NULL CHECK(quota_type IN ('ecc','fonctionnement','appui_bureaux','appui_debout')),
  montant         REAL NOT NULL CHECK(montant > 0),
  entry_date      TEXT NOT NULL,
  created_by      INTEGER,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (trimester_id) REFERENCES trimesters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quota_settle_lookup ON quota_settlements(school_id, trimester_id, quota_type);

ALTER TABLE cash_book_entries ADD COLUMN quota_settlement_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_cashbook_quota ON cash_book_entries(quota_settlement_id);
