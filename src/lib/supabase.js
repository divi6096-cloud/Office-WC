import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL    || 'https://osxwrmmhyuktexmtddof.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_SOQNCejCQKZaMxDEL7oYNg_4DHnvzUf'
)
