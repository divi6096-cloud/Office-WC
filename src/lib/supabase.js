import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL    || 'https://gwcymvdycrgfidruocbp.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_xJu0PAhbFE3ysUc_sBeSPA_4bVUSG0I'
)
