import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://euabqgnjdnphwdzmkuaq.supabase.co";
const SUPABASE_SECRET_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1YWJxZ25qZG5waHdkem1rdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY4NzI5NTgsImV4cCI6MjA2MjQ0ODk1OH0.2IQZMxRNyqfuyId0_WDoMxK8NM8V50v18CYm6UU5Pk4";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
