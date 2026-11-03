-- ============================================================================
-- Migration 0001 : Schéma initial - Plateforme de Gestion Financière Scolaire
-- ============================================================================

-- -----------------------------------------------------------------------
-- 1. ECOLES
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE NOT NULL,          -- code court utilisé pour les reçus (ex: "INST-KIVU")
  name          TEXT NOT NULL,                 -- nom complet de l'école
  address       TEXT,
  phone         TEXT,
  logo_url      TEXT,
  currency      TEXT DEFAULT 'CDF',
  active        INTEGER DEFAULT 1,             -- 1 = active, 0 = désactivée par le super admin
  created_by    INTEGER,                       -- users.id (super_admin)
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- 2. UTILISATEURS (super_admin, admin école, enseignant, percepteur)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id      INTEGER,                      -- NULL pour super_admin
  role           TEXT NOT NULL CHECK(role IN ('super_admin','admin','enseignant','percepteur')),
  name           TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  active         INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------
-- 3. ANNEES SCOLAIRES (ex: 2025-2026)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_years (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL,
  label         TEXT NOT NULL,                 -- "2025-2026"
  start_date    TEXT,
  end_date      TEXT,
  is_current    INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  UNIQUE(school_id, label)
);

-- -----------------------------------------------------------------------
-- 4. TRIMESTRES (1, 2, 3) liés à une année scolaire
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trimesters (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year_id  INTEGER NOT NULL,
  number          INTEGER NOT NULL CHECK(number IN (1,2,3)),
  name            TEXT NOT NULL,                -- "1er Trimestre"
  start_date      TEXT,
  end_date        TEXT,
  FOREIGN KEY (school_year_id) REFERENCES school_years(id) ON DELETE CASCADE,
  UNIQUE(school_year_id, number)
);

-- -----------------------------------------------------------------------
-- 5. CLASSES
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL,
  school_year_id  INTEGER NOT NULL,
  name            TEXT NOT NULL,                -- "6ème A"
  level           TEXT,                         -- "Primaire", "Secondaire", ...
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_year_id) REFERENCES school_years(id) ON DELETE CASCADE,
  UNIQUE(school_year_id, name)
);

-- -----------------------------------------------------------------------
-- 6. AFFECTATION ENSEIGNANTS <-> CLASSES (un enseignant peut être titulaire
--    de plusieurs classes, une classe peut avoir plusieurs enseignants)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_teachers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id     INTEGER NOT NULL,
  teacher_id   INTEGER NOT NULL,                -- users.id (role = enseignant)
  is_titulaire INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(class_id, teacher_id)
);

-- -----------------------------------------------------------------------
-- 7. AFFECTATION PERCEPTEURS <-> CLASSES (au moins un percepteur, ou plus,
--    par classe)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_percepteurs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id      INTEGER NOT NULL,
  percepteur_id INTEGER NOT NULL,               -- users.id (role = percepteur)
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (percepteur_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(class_id, percepteur_id)
);

-- -----------------------------------------------------------------------
-- 8. ELEVES
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL,
  class_id        INTEGER NOT NULL,
  matricule       TEXT,                         -- numéro matricule interne
  nom              TEXT NOT NULL,
  post_nom         TEXT NOT NULL,
  prenom           TEXT,
  sexe             TEXT CHECK(sexe IN ('M','F')),
  date_naissance   TEXT,
  parent_contact   TEXT,
  active           INTEGER DEFAULT 1,
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------
-- 9. FRAIS SCOLAIRES fixés par CLASSE et par TRIMESTRE
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fee_structures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL,
  class_id      INTEGER NOT NULL,
  trimester_id  INTEGER NOT NULL,
  montant       REAL NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (trimester_id) REFERENCES trimesters(id) ON DELETE CASCADE,
  UNIQUE(class_id, trimester_id)
);

-- -----------------------------------------------------------------------
-- 10. SEQUENCES DE NUMEROTATION DES REÇUS (par école + année scolaire)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipt_sequences (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL,
  school_year_id  INTEGER NOT NULL,
  last_number     INTEGER DEFAULT 0,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_year_id) REFERENCES school_years(id) ON DELETE CASCADE,
  UNIQUE(school_id, school_year_id)
);

-- -----------------------------------------------------------------------
-- 11. PAIEMENTS / PERCEPTIONS JOURNALIERES (registre de perception)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL,
  student_id        INTEGER NOT NULL,
  class_id          INTEGER NOT NULL,
  trimester_id      INTEGER NOT NULL,
  montant           REAL NOT NULL,
  date_paiement     TEXT NOT NULL,               -- YYYY-MM-DD
  percepteur_id     INTEGER NOT NULL,            -- users.id
  receipt_number    TEXT UNIQUE NOT NULL,
  cancelled         INTEGER DEFAULT 0,           -- annulation éventuelle
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (trimester_id) REFERENCES trimesters(id) ON DELETE CASCADE,
  FOREIGN KEY (percepteur_id) REFERENCES users(id)
);

-- -----------------------------------------------------------------------
-- 12. CATEGORIES BUDGETAIRES (Recette / Dépense)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('RECETTE','DEPENSE')),
  name        TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------
-- 13. PREVISIONS BUDGETAIRES (par catégorie, par trimestre ou annuel)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_previsions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL,
  school_year_id      INTEGER NOT NULL,
  trimester_id        INTEGER,                   -- NULL = prévision annuelle
  budget_category_id  INTEGER NOT NULL,
  montant_prevu       REAL NOT NULL,
  notes               TEXT,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_year_id) REFERENCES school_years(id) ON DELETE CASCADE,
  FOREIGN KEY (trimester_id) REFERENCES trimesters(id) ON DELETE CASCADE,
  FOREIGN KEY (budget_category_id) REFERENCES budget_categories(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------
-- 14. LIVRE DE CAISSE
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_book_entries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL,
  school_year_id      INTEGER NOT NULL,
  entry_date          TEXT NOT NULL,              -- YYYY-MM-DD
  code                TEXT CHECK(code IN ('F','B','R','AUT','')) DEFAULT '',
  libelle             TEXT NOT NULL,
  ref                 TEXT,
  entree              REAL DEFAULT 0,
  sortie              REAL DEFAULT 0,
  budget_category_id  INTEGER,                    -- rattachement prévision/réalisation
  is_auto             INTEGER DEFAULT 0,           -- 1 = généré automatiquement (agrégat "Frais scolaire")
  auto_source_date    TEXT,                        -- date agrégée (pour upsert idempotent)
  created_by          INTEGER,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_year_id) REFERENCES school_years(id) ON DELETE CASCADE,
  FOREIGN KEY (budget_category_id) REFERENCES budget_categories(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cashbook_auto_unique
  ON cash_book_entries(school_id, auto_source_date)
  WHERE is_auto = 1;

-- -----------------------------------------------------------------------
-- INDEXES DE PERFORMANCE
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_school       ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_classes_school_year ON classes(school_year_id);
CREATE INDEX IF NOT EXISTS idx_students_class      ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_payments_student    ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_class_date  ON payments(class_id, date_paiement);
CREATE INDEX IF NOT EXISTS idx_payments_trimester   ON payments(trimester_id);
CREATE INDEX IF NOT EXISTS idx_cashbook_school_date ON cash_book_entries(school_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_feestruct_class      ON fee_structures(class_id);
