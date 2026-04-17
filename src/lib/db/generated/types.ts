// Placeholder. Regenerate with `pnpm supabase:gen-types` after `supabase start`.
// Until then, tables/views/functions are typed as loose records so
// application code compiles. Once the real types are generated, schema
// drift will surface here as type errors — exactly what we want.
// `any` here is deliberate: until `supabase gen types` runs against the
// live schema, we permit arbitrary row shapes. The strict types arrive
// automatically once this file is regenerated.

// eslint-disable-next-line
type AnyTable = { Row: any; Insert: any; Update: any; Relationships: [] }

// eslint-disable-next-line
type AnyView = { Row: any; Relationships: [] }

export type Database = {
  public: {
    Tables: {
      [K: string]: AnyTable
    }
    Views: {
      [K: string]: AnyView
    }
    Functions: {
      [K: string]: {
        Args: Record<string, unknown>
        Returns: unknown
      }
    }
    Enums: Record<string, string>
    CompositeTypes: Record<string, Record<string, unknown>>
  }
}
