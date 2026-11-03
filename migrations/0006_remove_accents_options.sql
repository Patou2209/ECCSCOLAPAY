-- Nom du chef d'établissement (modifiable dans les paramètres de l'école)
ALTER TABLE schools ADD COLUMN head_name TEXT;

-- Normalisation sans accents des options et noms de classes existants.
-- « Pédagogie générale » (avec accents) pouvait ne pas s'afficher selon
-- l'encodage Unicode (NFC/NFD) du navigateur/OS qui a créé la classe.
-- On remplace par « Pedagogie generale » partout (option + nom + nom du compte classe).

-- Option : les deux formes Unicode possibles de « Pédagogie générale »
UPDATE classes SET option = 'Pedagogie generale' WHERE option LIKE 'P_dagogie g_n_rale' OR option LIKE 'Pe%dagogie ge%ne%rale';

-- Noms de classes contenant l'option avec accents (ex. « 1ère Pédagogie générale A »)
UPDATE classes SET name = REPLACE(name, 'Pédagogie générale', 'Pedagogie generale') WHERE name LIKE '%dagogie g%';
-- Forme décomposée NFD (e + accent combinant) éventuelle : traitée par motif large
UPDATE classes SET name = REPLACE(REPLACE(name, 'Pédagogie', 'Pedagogie'), 'générale', 'generale') WHERE name LIKE '%dagogie%';

-- Comptes utilisateurs « Classe … » liés
UPDATE users SET name = REPLACE(REPLACE(name, 'Pédagogie', 'Pedagogie'), 'générale', 'generale') WHERE role = 'classe' AND name LIKE '%dagogie%';

-- Forme Unicode décomposée (NFD) : l'accent est un caractère séparé (U+0301 aigu,
-- U+0300 grave). On supprime ces caractères combinants → « é » devient « e ».
UPDATE classes SET option = REPLACE(REPLACE(option, char(769), ''), char(768), '') WHERE option LIKE '%' || char(769) || '%' OR option LIKE '%' || char(768) || '%';
UPDATE classes SET name = REPLACE(REPLACE(name, char(769), ''), char(768), '') WHERE name LIKE '%' || char(769) || '%' OR name LIKE '%' || char(768) || '%';
UPDATE users SET name = REPLACE(REPLACE(name, char(769), ''), char(768), '') WHERE role = 'classe' AND (name LIKE '%' || char(769) || '%' OR name LIKE '%' || char(768) || '%');
