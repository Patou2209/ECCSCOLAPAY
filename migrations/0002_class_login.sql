-- ============================================================================
-- Migration 0002 : Comptes de connexion pour les CLASSES
-- Chaque classe reçoit désormais son propre compte (rôle 'classe') avec un
-- email et un mot de passe générés automatiquement à la création, afin que
-- la classe elle-même puisse se connecter et consulter ses informations
-- (élèves, registre de perception en lecture seule, dettes, frais).
-- L'école (admin) garde la possibilité d'ouvrir chaque classe et de voir
-- tout son contenu, ainsi que de régénérer le mot de passe de la classe.
--
-- NOTE TECHNIQUE : Cloudflare D1 n'honore pas de façon fiable
-- `PRAGMA legacy_alter_table = ON` lors d'un `ALTER TABLE ... RENAME` lancé
-- via `wrangler d1 migrations apply` (chaque instruction semble exécutée
-- indépendamment). Résultat : un simple RENAME de la table `users` laisse
-- les FOREIGN KEY des tables dépendantes (class_teachers, class_percepteurs,
-- payments, cash_book_entries) pointer vers l'ancienne table renommée.
-- On recrée donc explicitement TOUTES les tables qui référencent `users`
-- pour qu'elles pointent vers la nouvelle table `users`.
-- ============================================================================

PRAGMA defer_foreign_keys = TRUE;

-- -----------------------------------------------------------------------
-- 1) Recréation de USERS : ajoute le rôle 'classe' au CHECK + colonne class_id
-- -----------------------------------------------------------------------
ALTER TABLE users RENAME TO users_old_0002;

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id      INTEGER,                      -- NULL pour super_admin
  role           TEXT NOT NULL CHECK(role IN ('super_admin','admin','enseignant','percepteur','classe')),
  class_id       INTEGER,                      -- classes.id, uniquement pour role = 'classe'
  name           TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  active         INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

INSERT INTO users (id, school_id, role, class_id, name, email, phone, password_hash, password_salt, active, created_at)
SELECT id, school_id, role, NULL, name, email, phone, password_hash, password_salt, active, created_at
FROM users_old_0002;

-- -----------------------------------------------------------------------
-- 2) Recréation de CLASS_TEACHERS pour pointer vers la nouvelle table users
-- -----------------------------------------------------------------------
ALTER TABLE class_teachers RENAME TO class_teachers_old_0002;

CREATE TABLE class_teachers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id     INTEGER NOT NULL,
  teacher_id   INTEGER NOT NULL,
  is_titulaire INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(class_id, teacher_id)
);

INSERT INTO class_teachers (id, class_id, teacher_id, is_titulaire, created_at)
SELECT id, class_id, teacher_id, is_titulaire, created_at FROM class_teachers_old_0002;

DROP TABLE class_teachers_old_0002;

-- -----------------------------------------------------------------------
-- 3) Recréation de CLASS_PERCEPTEURS pour pointer vers la nouvelle table users
-- -----------------------------------------------------------------------
ALTER TABLE class_percepteurs RENAME TO class_percepteurs_old_0002;

CREATE TABLE class_percepteurs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id      INTEGER NOT NULL,
  percepteur_id INTEGER NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (percepteur_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(class_id, percepteur_id)
);

INSERT INTO class_percepteurs (id, class_id, percepteur_id, created_at)
SELECT id, class_id, percepteur_id, created_at FROM class_percepteurs_old_0002;

DROP TABLE class_percepteurs_old_0002;

-- -----------------------------------------------------------------------
-- 4) Recréation de PAYMENTS pour pointer vers la nouvelle table users
--    (percepteur_id)
-- -----------------------------------------------------------------------
ALTER TABLE payments RENAME TO payments_old_0002;

CREATE TABLE payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL,
  student_id        INTEGER NOT NULL,
  class_id          INTEGER NOT NULL,
  trimester_id      INTEGER NOT NULL,
  montant           REAL NOT NULL,
  date_paiement     TEXT NOT NULL,
  percepteur_id     INTEGER NOT NULL,
  receipt_number    TEXT UNIQUE NOT NULL,
  cancelled         INTEGER DEFAULT 0,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (trimester_id) REFERENCES trimesters(id) ON DELETE CASCADE,
  FOREIGN KEY (percepteur_id) REFERENCES users(id)
);

INSERT INTO payments (id, school_id, student_id, class_id, trimester_id, montant, date_paiement, percepteur_id, receipt_number, cancelled, created_at)
SELECT id, school_id, student_id, class_id, trimester_id, montant, date_paiement, percepteur_id, receipt_number, cancelled, created_at FROM payments_old_0002;

DROP TABLE payments_old_0002;

CREATE INDEX IF NOT EXISTS idx_payments_student    ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_class_date  ON payments(class_id, date_paiement);
CREATE INDEX IF NOT EXISTS idx_payments_trimester   ON payments(trimester_id);

-- -----------------------------------------------------------------------
-- 5) Recréation de CASH_BOOK_ENTRIES pour pointer vers la nouvelle table users
--    (created_by)
-- -----------------------------------------------------------------------
ALTER TABLE cash_book_entries RENAME TO cash_book_entries_old_0002;

CREATE TABLE cash_book_entries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL,
  school_year_id      INTEGER NOT NULL,
  entry_date          TEXT NOT NULL,
  code                TEXT CHECK(code IN ('F','B','R','AUT','')) DEFAULT '',
  libelle             TEXT NOT NULL,
  ref                 TEXT,
  entree              REAL DEFAULT 0,
  sortie              REAL DEFAULT 0,
  budget_category_id  INTEGER,
  is_auto             INTEGER DEFAULT 0,
  auto_source_date    TEXT,
  created_by          INTEGER,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_year_id) REFERENCES school_years(id) ON DELETE CASCADE,
  FOREIGN KEY (budget_category_id) REFERENCES budget_categories(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

INSERT INTO cash_book_entries (id, school_id, school_year_id, entry_date, code, libelle, ref, entree, sortie, budget_category_id, is_auto, auto_source_date, created_by, created_at)
SELECT id, school_id, school_year_id, entry_date, code, libelle, ref, entree, sortie, budget_category_id, is_auto, auto_source_date, created_by, created_at FROM cash_book_entries_old_0002;

DROP TABLE cash_book_entries_old_0002;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cashbook_auto_unique
  ON cash_book_entries(school_id, auto_source_date)
  WHERE is_auto = 1;
CREATE INDEX IF NOT EXISTS idx_cashbook_school_date ON cash_book_entries(school_id, entry_date);

-- -----------------------------------------------------------------------
-- 6) Nettoyage final
-- -----------------------------------------------------------------------
DROP TABLE users_old_0002;

CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_class  ON users(class_id);
