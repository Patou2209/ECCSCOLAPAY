// Types partagés pour l'application

export type Role = 'super_admin' | 'admin' | 'enseignant' | 'percepteur' | 'classe'

export type Bindings = {
  DB: D1Database
  JWT_SECRET?: string
}

export type JwtPayload = {
  uid: number
  role: Role
  school_id: number | null
  class_id?: number | null
  name: string
  email: string
  exp: number
  // Présent uniquement lorsque ce jeton a été émis par "impersonation" :
  // un admin a ouvert une classe et agit avec les droits du rôle 'classe',
  // tout en gardant une référence signée vers son propre compte admin pour
  // pouvoir revenir à son espace d'administration.
  impersonating?: {
    admin_uid: number
    admin_name: string
    admin_email: string
  } | null
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    user: JwtPayload
  }
}
