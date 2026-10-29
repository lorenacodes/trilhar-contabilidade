/* Cliente Supabase do projeto real "Portal do Cliente" (não confundir com o
   Supabase Auth do lado admin — este arquivo só é carregado nas páginas do
   cliente: index.html, painel.html, categoria.html, perfil.html).

   Nome da variável é "sb" e não "supabase" de propósito: o script do CDN
   já expõe um objeto global window.supabase (o namespace da lib), então
   reusar o mesmo nome pro cliente instanciado sobrescreveria esse global. */
const SUPABASE_URL = "https://mssnpcdtsmdbnedmihjh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zc25wY2R0c21kYm5lZG1paGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzE0NjIsImV4cCI6MjA5OTY0NzQ2Mn0.z8tYEb5A-gweM00nhrxKtVa2RYjjku_EUDCEp5BT8cw";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
