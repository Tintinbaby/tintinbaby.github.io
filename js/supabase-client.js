/* js/supabase-client.js
 * Configura el cliente de Supabase que usa render.js para leer el
 * catálogo. Solo contiene datos públicos por diseño: el Project URL
 * y la "publishable/anon key" están hechos para vivir en el navegador
 * (son los mismos que recibe cualquier visitante). NUNCA debe ponerse
 * aquí una service_role key ni ninguna contraseña de base de datos.
 *
 * Si por cualquier motivo este cliente no queda disponible (el script
 * del CDN no cargó, por ejemplo), render.js lo detecta automáticamente
 * y usa los JSON locales (data/categories.json, data/products.json)
 * como respaldo — ver loadCategories()/loadProducts() en render.js.
 */
const SUPABASE_URL = 'https://bmekgxaxfpyepzhynxyz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TILlqW3ajbqoSl7ik0EJdQ__OOzUM9A';

window.supabaseClient = (typeof window.supabase !== 'undefined' && window.supabase.createClient)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

if (!window.supabaseClient) {
  console.warn(
    '[supabase-client.js] No se pudo inicializar el cliente de Supabase ' +
    '(¿no cargó el script del CDN?). El catálogo usará el respaldo local (data/*.json).'
  );
}
