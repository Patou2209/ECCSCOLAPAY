-- ============================================================================
-- Seed : compte super admin demandé par le client
-- email: patoukaziama@gmail.com / mot de passe: patou2209
-- (hash PBKDF2-SHA256, 100000 itérations, sel aléatoire — voir src/utils/crypto.ts)
-- Insertion idempotente : ne fait rien si l'email existe déjà.
-- ============================================================================
INSERT INTO users (school_id, role, name, email, password_hash, password_salt)
SELECT NULL, 'super_admin', 'Patou Kaziama', 'patoukaziama@gmail.com',
       '81fa86da0d59b227844f38b5706e42a8c8177840360e826e84c6af8bf73cac98',
       'c9e284b56c4be2f2e6c6dcca90a826d1'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'patoukaziama@gmail.com');
