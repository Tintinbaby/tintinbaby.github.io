/* render.js
 * Lee /data/categories.json y /data/products.json y construye las secciones
 * de catálogo dentro de <main id="catalog">, además de los enlaces de
 * navegación (menú principal y "Colección" del footer), reproduciendo
 * exactamente el markup y las clases CSS que antes estaban escritas a mano.
 *
 * Esta capa es la única que conoce la forma de los datos. El día que los
 * JSON se reemplacen por llamadas a una API/backend, solo hay que cambiar
 * las dos funciones de carga (loadCategories/loadProducts) — el resto del
 * archivo (construcción del DOM) no necesita tocarse.
 */

// Valores permitidos para category.layout. Cualquier otro valor se rechaza
// de forma explícita (ver buildCategorySection) en vez de caer, en
// silencio, en el layout de carruseles.
const ALLOWED_LAYOUTS = ['simple-grid', 'variant-carousels'];

// Valores permitidos para category.sectionModifier además de "sin
// modificador" (null/undefined/""), que siempre es válido. Hoy el proyecto
// solo usa "alt" (ver css/styles.css: ".section.alt").
const ALLOWED_SECTION_MODIFIERS = ['alt'];

// Valor por defecto del texto del CTA de una variante cuando el producto no
// define uno propio. Antes se repetía "Personalizar" en las 18 variantes;
// ahora vive en un solo lugar y cada variante solo lo sobrescribe si
// necesita un texto distinto. (El enlace de destino de todos los CTA de
// producto/variante ya no depende de cta_href — ver WHATSAPP_NUMBER más
// abajo — así que ya no hace falta un DEFAULT_VARIANT_CTA_HREF.)
const DEFAULT_VARIANT_CTA_LABEL = 'Personalizar';

/* ---------- WhatsApp: enlace de contacto para los botones de pedido ----------
 * Número de contacto real de Tintinbaby, en el formato internacional que
 * exige wa.me (sin "+", sin espacios): +57 323 9714689 -> 573239714689.
 * Todos los botones de "pedido" de un producto o de una variante (los que
 * antes usaban products.cta_href / product_variants.cta_href) ahora abren
 * WhatsApp con un mensaje prellenado que menciona el producto (y la
 * variante, si aplica) en vez de navegar al href que traiga ese campo. El
 * campo cta_href en sí no se toca ni se elimina de ningún lado (sigue
 * viajando desde Supabase/el JSON de respaldo por si se usa en otro lugar
 * más adelante) — solo se deja de leer aquí para construir el href final.
 */
const WHATSAPP_NUMBER = '573239714689';

function buildWhatsAppUrl(message) {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

function buildProductWhatsAppMessage(productName) {
  return `Hola, estoy interesado en el ${productName}. ¿Me pueden dar información?`;
}

function buildVariantWhatsAppMessage(productName, variantName) {
  return `Hola, estoy interesado en el ${productName} - Variante ${variantName}. ¿Me pueden dar información?`;
}

/* ---------- Carga de datos: Supabase con respaldo a JSON local ----------
 * loadCategories()/loadProducts() intentan primero leer de Supabase (vía
 * el cliente que expone js/supabase-client.js en window.supabaseClient) y
 * transforman el resultado a la MISMA forma que siempre devolvieron estas
 * dos funciones (camelCase, price anidado, variants/images como arreglos).
 * El resto del archivo no sabe ni le importa de dónde vinieron los datos.
 *
 * Si Supabase no está disponible, tarda demasiado, o responde con error,
 * se cae automáticamente al fetch('data/*.json') original — sin cambiar
 * en nada la experiencia del visitante.
 */

const SUPABASE_TIMEOUT_MS = 4000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${ms}ms)`)), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function sortByOrder(rows) {
  return (rows || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function mapImageUrls(imageRows) {
  return sortByOrder(imageRows).map(img => img.url);
}

function firstImageAlt(imageRows) {
  const sorted = sortByOrder(imageRows);
  return (sorted[0] && sorted[0].alt) || '';
}

function mapPrice(row) {
  if (!row.price_mode) return undefined;
  return {
    mode: row.price_mode,
    amount: row.price_amount === null || row.price_amount === undefined ? null : Number(row.price_amount),
    originalAmount: row.price_original_amount === null || row.price_original_amount === undefined
      ? null
      : Number(row.price_original_amount),
    currency: row.price_currency
  };
}

function mapCategoryRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    anchorId: row.anchor_id,
    order: row.order,
    active: row.active,
    navLabel: row.nav_label,
    footerLabel: row.footer_label,
    eyebrow: row.eyebrow,
    heading: row.heading,
    description: row.description,
    layout: row.layout,
    typeHeading: row.type_heading,
    note: row.note,
    sectionModifier: row.section_modifier
  };
}

function mapVariantRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    // "Qué incluye" propio de la variante — mismo mapeo que ya usa
    // mapProductRow() para product.includes (Etapa 4C): Supabase/PostgREST
    // entrega la columna jsonb ya como array de JS, sin parseo manual.
    // Independiente del includes del producto padre.
    includes: row.includes || [],
    images: mapImageUrls(row.images),
    imageAlt: row.image_alt,
    placeholderTone: row.placeholder_tone,
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    price: mapPrice(row)
  };
}

function mapProductRow(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    order: row.order,
    active: row.active,
    featured: row.featured,
    name: row.name,
    badge: row.badge,
    description: row.description,
    completeLabel: row.complete_label,
    includes: row.includes || [],
    images: mapImageUrls(row.images),
    imageAlt: firstImageAlt(row.images),
    price: mapPrice(row),
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    variants: sortByOrder(row.product_variants).map(mapVariantRow)
  };
}

async function loadCategoriesFromJson() {
  const res = await fetch('data/categories.json');
  if (!res.ok) throw new Error('No se pudieron cargar las categorías');
  return res.json();
}

async function loadProductsFromJson() {
  const res = await fetch('data/products.json');
  if (!res.ok) throw new Error('No se pudieron cargar los productos');
  return res.json();
}

async function loadCategories() {
  try {
    if (!window.supabaseClient) throw new Error('Cliente de Supabase no disponible');
    const { data, error } = await withTimeout(
      window.supabaseClient.from('categories').select('*'),
      SUPABASE_TIMEOUT_MS
    );
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Respuesta de Supabase con forma inesperada');
    return data.map(mapCategoryRow);
  } catch (err) {
    console.warn('[render.js] No se pudieron cargar las categorías desde Supabase, usando respaldo local (data/categories.json).', err);
    return loadCategoriesFromJson();
  }
}

async function loadProducts() {
  try {
    if (!window.supabaseClient) throw new Error('Cliente de Supabase no disponible');
    const { data, error } = await withTimeout(
      window.supabaseClient
        .from('products')
        .select('*, images(*), product_variants(*, images(*))'),
      SUPABASE_TIMEOUT_MS
    );
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Respuesta de Supabase con forma inesperada');
    return data.map(mapProductRow);
  } catch (err) {
    console.warn('[render.js] No se pudieron cargar los productos desde Supabase, usando respaldo local (data/products.json).', err);
    return loadProductsFromJson();
  }
}

function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.id) node.id = opts.id;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.attrs) {
    Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  }
  return node;
}

/* ---------- Precio: modelo unificado ----------
 * Todo precio (de producto tipo "set" o de variante) llega como:
 *   { mode: "fixed" | "promo" | "consult" | "from", amount, originalAmount, currency }
 * con montos numéricos, no strings ya formateados. Estas funciones son las
 * únicas responsables de convertir un número a texto ("$275.000") y de
 * calcular el ahorro en modo "promo".
 */

function formatCurrency(amount, currency) {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return null;
  const rounded = Math.round(amount);
  const withThousands = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = rounded < 0 ? '-' : '';
  const symbol = currency === 'COP' || !currency ? '$' : `${currency} `;
  return `${sign}${symbol}${withThousands}`;
}

function resolvePrice(price) {
  if (!price || !price.mode) return null;
  const currency = price.currency || 'COP';

  switch (price.mode) {
    case 'fixed':
      return { kind: 'fixed', amountText: formatCurrency(price.amount, currency) };
    case 'promo':
      return {
        kind: 'promo',
        originalText: formatCurrency(price.originalAmount, currency),
        amountText: formatCurrency(price.amount, currency),
        savingsText:
          typeof price.amount === 'number' && typeof price.originalAmount === 'number'
            ? `Ahorras ${formatCurrency(price.originalAmount - price.amount, currency)}`
            : null
      };
    case 'consult':
      return { kind: 'consult' };
    case 'from':
      return { kind: 'from', amountText: formatCurrency(price.amount, currency) };
    default:
      console.error(`[render.js] Modo de precio no reconocido: "${price.mode}". No se renderizará precio.`);
      return null;
  }
}

/* Bloque de precio "grande" usado en las tarjetas de tipo set (simple-grid). */
function buildPriceBlock(price) {
  const block = el('div', { className: 'set-price-block' });
  const resolved = resolvePrice(price);
  if (!resolved) return block;

  if (resolved.kind === 'promo') {
    if (resolved.originalText) block.appendChild(el('span', { className: 'price-old', text: resolved.originalText }));
    if (resolved.amountText) block.appendChild(el('span', { className: 'price-promo', text: resolved.amountText }));
    if (resolved.savingsText) block.appendChild(el('span', { className: 'set-save', text: resolved.savingsText }));
  } else if (resolved.kind === 'consult') {
    block.appendChild(el('span', { className: 'price-ask', text: 'Precio a consultar' }));
  } else if (resolved.kind === 'fixed') {
    if (resolved.amountText) block.appendChild(el('span', { className: 'price-promo', text: resolved.amountText }));
  } else if (resolved.kind === 'from') {
    block.appendChild(el('span', { className: 'price-ask', text: resolved.amountText ? `Desde ${resolved.amountText}` : 'Desde $—' }));
  }

  return block;
}

/* Texto de precio "chico" usado en las tarjetas de variante (una sola línea). */
function variantPriceText(price) {
  const resolved = resolvePrice(price);
  if (!resolved) return '';

  switch (resolved.kind) {
    case 'from':
      return `Desde ${resolved.amountText || '$—'}`;
    case 'fixed':
      return resolved.amountText || '';
    case 'promo':
      return resolved.amountText || '';
    case 'consult':
      return 'Precio a consultar';
    default:
      return '';
  }
}

function buildSectionHead(category) {
  const head = el('div', { className: 'section-head reveal' });
  const inner = el('div');
  inner.appendChild(el('span', { className: 'eyebrow', text: category.eyebrow }));
  inner.appendChild(el('h2', { text: category.heading }));
  head.appendChild(inner);
  head.appendChild(el('p', { text: category.description }));
  return head;
}

function buildCarouselNav(trackId) {
  const nav = el('div', { className: 'carousel-nav' });
  const prev = el('button', {
    className: 'cnav prev',
    text: '\u2039',
    attrs: { 'aria-label': 'Anterior', 'data-target': trackId }
  });
  const next = el('button', {
    className: 'cnav next',
    text: '\u203a',
    attrs: { 'aria-label': 'Siguiente', 'data-target': trackId }
  });
  nav.appendChild(prev);
  nav.appendChild(next);
  return nav;
}

function buildSetCard(product) {
  // Etapa 4H: "product-card" es la clase base compartida que centraliza el
  // tamaño visual de la tarjeta (ver css/styles.css, sección PRODUCT CARD
  // BASE). "set-card" se conserva íntegra para todo lo que sigue siendo
  // propio de simple-grid (cuerpo, lista de "incluye", precio, etc.).
  const card = el('article', { className: 'product-card set-card reveal' });

  // Igual que arriba: "product-card-media" centraliza aspect-ratio y el
  // llenado de la imagen (width/height/object-fit); "set-card-media" sigue
  // aportando lo propio de este layout (overflow, fondo, posicionamiento
  // del badge).
  const media = el('div', { className: 'product-card-media set-card-media' });
  if (product.badge) {
    media.appendChild(el('span', { className: 'set-badge', text: product.badge }));
  }
  const productImage = (product.images && product.images[0]) || '';
  media.appendChild(el('img', {
    attrs: { src: productImage, alt: product.imageAlt || '' }
  }));
  card.appendChild(media);

  const body = el('div', { className: 'set-card-body' });
  body.appendChild(el('span', { className: 'eyebrow', text: product.completeLabel }));
  body.appendChild(el('h3', { text: product.name }));
  body.appendChild(el('p', { className: 'set-card-desc', text: product.description }));

  const ul = el('ul');
  (product.includes || []).forEach(piece => {
    ul.appendChild(el('li', { text: piece }));
  });
  body.appendChild(ul);

  body.appendChild(buildPriceBlock(product.price));

  body.appendChild(el('a', {
    className: 'btn-primary',
    text: product.ctaLabel,
    attrs: {
      href: buildWhatsAppUrl(buildProductWhatsAppMessage(product.name)),
      target: '_blank',
      rel: 'noopener noreferrer'
    }
  }));

  card.appendChild(body);
  return card;
}

function buildSetsLayout(category, products) {
  const wrap = el('div', { className: 'product-type' });

  const typeHead = el('div', { className: 'type-head reveal' });
  typeHead.appendChild(el('h3', { text: category.typeHeading }));
  const trackId = `${category.anchorId}-track`;
  typeHead.appendChild(buildCarouselNav(trackId));
  wrap.appendChild(typeHead);

  const carousel = el('div', { className: 'carousel' });
  const track = el('div', { className: 'carousel-track sets-track', id: trackId });
  products
    .filter(p => p.active)
    .sort((a, b) => a.order - b.order)
    .forEach(p => track.appendChild(buildSetCard(p)));
  carousel.appendChild(track);
  wrap.appendChild(carousel);

  if (category.note) {
    wrap.appendChild(el('p', { className: 'sets-note reveal', text: category.note }));
  }

  return wrap;
}

function buildVariantCard(product, variant, index) {
  // Etapa 4H: misma clase base compartida "product-card" que en
  // buildSetCard, para que ambos layouts usen exactamente el mismo tamaño
  // de tarjeta sin duplicar valores (ver css/styles.css, sección PRODUCT
  // CARD BASE). "card" se conserva íntegra para lo propio de este layout.
  const card = el('div', { className: 'product-card card reveal' });

  const mediaClass = variant.placeholderTone && variant.placeholderTone !== 'default'
    ? `product-card-media card-media tone-${variant.placeholderTone}`
    : 'product-card-media card-media';
  const media = el('div', { className: mediaClass });

  const variantImage = variant.images && variant.images[0];
  if (variantImage) {
    media.appendChild(el('img', { attrs: { src: variantImage, alt: variant.imageAlt || variant.name || '' } }));
  } else {
    const ph = el('div', { className: 'ph' });
    ph.appendChild(el('div', { className: 'icon', text: '\u2726' }));
    ph.appendChild(document.createTextNode(`Foto — diseño ${index + 1}`));
    media.appendChild(ph);
  }
  card.appendChild(media);

  const body = el('div', { className: 'card-body' });
  body.appendChild(el('span', { className: 'eyebrow', text: product.name }));
  body.appendChild(el('h3', { text: variant.name }));
  body.appendChild(el('p', { text: variant.description }));

  // Etapa 4I: "Qué incluye" propio de la variante — mismo concepto que
  // buildSetCard() usa para product.includes, pero totalmente
  // independiente (no hereda del producto padre ni de otras variantes).
  // Si la variante no tiene elementos, no se agrega ningún <ul> — así no
  // aparece una sección vacía en el catálogo.
  if (variant.includes && variant.includes.length > 0) {
    const ul = el('ul');
    variant.includes.forEach(piece => {
      ul.appendChild(el('li', { text: piece }));
    });
    body.appendChild(ul);
  }

  const foot = el('div', { className: 'card-foot' });
  foot.appendChild(el('span', { className: 'price', text: variantPriceText(variant.price) }));
  foot.appendChild(el('a', {
    className: 'add-link',
    text: variant.ctaLabel || DEFAULT_VARIANT_CTA_LABEL,
    attrs: {
      href: buildWhatsAppUrl(buildVariantWhatsAppMessage(product.name, variant.name)),
      target: '_blank',
      rel: 'noopener noreferrer'
    }
  }));
  body.appendChild(foot);

  card.appendChild(body);
  return card;
}

function buildVariantCarouselsLayout(products) {
  const fragment = document.createDocumentFragment();

  products
    .filter(p => p.active)
    .sort((a, b) => a.order - b.order)
    .forEach(product => {
      const wrap = el('div', { className: 'product-type' });

      const typeHead = el('div', { className: 'type-head reveal' });
      typeHead.appendChild(el('h3', { text: product.name }));
      const trackId = `${product.id}-track`;
      typeHead.appendChild(buildCarouselNav(trackId));
      wrap.appendChild(typeHead);

      const carousel = el('div', { className: 'carousel' });
      const track = el('div', { className: 'carousel-track', id: trackId });
      (product.variants || [])
        .filter(v => v.active)
        .forEach((v, i) => track.appendChild(buildVariantCard(product, v, i)));
      carousel.appendChild(track);
      wrap.appendChild(carousel);

      fragment.appendChild(wrap);
    });

  return fragment;
}

/* Resuelve la clase de <section>, validando sectionModifier de forma
 * defensiva: un valor no reconocido no se aplica (no se inyecta como clase
 * CSS arbitraria) y queda registrado con claridad en la consola. */
function resolveSectionClass(category) {
  const modifier = category.sectionModifier;
  if (!modifier) return 'section';
  if (!ALLOWED_SECTION_MODIFIERS.includes(modifier)) {
    console.error(
      `[render.js] sectionModifier no reconocido: "${modifier}" en categoría "${category.id}". Se ignora y no se aplica ningún modificador.`
    );
    return 'section';
  }
  return `section ${modifier}`;
}

function buildCategorySection(category, allProducts) {
  if (!ALLOWED_LAYOUTS.includes(category.layout)) {
    console.error(
      `[render.js] Layout no reconocido: "${category.layout}" en categoría "${category.id}". Valores permitidos: ${ALLOWED_LAYOUTS.join(', ')}. La categoría no se renderizará.`
    );
    return null;
  }

  const section = el('section', {
    className: resolveSectionClass(category),
    id: category.anchorId
  });

  const wrap = el('div', { className: 'wrap' });
  wrap.appendChild(buildSectionHead(category));

  const productsInCategory = allProducts.filter(p => p.categoryId === category.id);

  if (category.layout === 'simple-grid') {
    wrap.appendChild(buildSetsLayout(category, productsInCategory));
  } else {
    wrap.appendChild(buildVariantCarouselsLayout(productsInCategory));
  }

  section.appendChild(wrap);
  return section;
}

/* ---------- Navegación: menú principal y "Colección" del footer ----------
 * Antes vivían como <a> escritos a mano en index.html. Ahora se generan a
 * partir de las categorías activas de categories.json, en el mismo orden
 * (category.order), para que una categoría nueva aparezca automáticamente
 * sin editar el HTML. Los enlaces que no son categorías (Personalización,
 * Contacto) se mantienen como HTML estático y no se tocan aquí.
 */
function buildNavLink(category) {
  return el('a', { text: category.navLabel, attrs: { href: `#${category.anchorId}` } });
}

function buildFooterCollectionItem(category) {
  const li = el('li');
  li.appendChild(el('a', { text: category.footerLabel || category.navLabel, attrs: { href: `#${category.anchorId}` } }));
  return li;
}

function renderNavigation(categories) {
  const activeSorted = categories
    .filter(c => c.active)
    .slice()
    .sort((a, b) => a.order - b.order);

  const navlinks = document.getElementById('navlinks');
  if (navlinks) {
    const frag = document.createDocumentFragment();
    activeSorted.forEach(c => frag.appendChild(buildNavLink(c)));
    navlinks.insertBefore(frag, navlinks.firstElementChild);
  }

  const footerList = document.getElementById('footer-collection-list');
  if (footerList) {
    const frag = document.createDocumentFragment();
    activeSorted.forEach(c => frag.appendChild(buildFooterCollectionItem(c)));
    footerList.insertBefore(frag, footerList.firstElementChild);
  }
}

async function renderCatalog() {
  const mount = document.getElementById('catalog');

  try {
    const [categories, products] = await Promise.all([loadCategories(), loadProducts()]);

    renderNavigation(categories);

    if (mount) {
      categories
        .filter(c => c.active)
        .sort((a, b) => a.order - b.order)
        .forEach(category => {
          const section = buildCategorySection(category, products);
          if (section) mount.appendChild(section);
        });
    }

    document.dispatchEvent(new CustomEvent('catalog:rendered'));
  } catch (err) {
    console.error('Error al renderizar el catálogo:', err);
  }
}

document.addEventListener('DOMContentLoaded', renderCatalog);

/* ---------- Etapa 5: contenido editable de secciones informativas ----------
 * site_sections es una tabla genérica (key/eyebrow/title/description/
 * image_url/image_alt/visible) — hoy solo tiene dos filas ("personalizacion"
 * y "coleccion-permanente"), pero está pensada para poder agregar más
 * secciones informativas a futuro sin volver a tocar el esquema. Esta capa
 * es la única que sabe, por código, en qué elemento del DOM va cada "key"
 * — el resto del archivo no se toca.
 *
 * Si Supabase no responde, la fila no existe, o algún campo llega vacío, se
 * deja intacto el texto que ya está escrito a mano en index.html — ese
 * texto actúa como respaldo implícito (igual que loadProductsFromJson() es
 * el respaldo de loadProducts()), así que no hace falta un data/*.json
 * aparte para estas dos secciones ni el catálogo puede quedar con textos
 * vacíos.
 */
async function loadSiteSections() {
  try {
    if (!window.supabaseClient) throw new Error('Cliente de Supabase no disponible');
    const { data, error } = await withTimeout(
      window.supabaseClient.from('site_sections').select('*'),
      SUPABASE_TIMEOUT_MS
    );
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Respuesta de Supabase con forma inesperada');
    const byKey = {};
    data.forEach(row => { byKey[row.key] = row; });
    return byKey;
  } catch (err) {
    console.warn('[render.js] No se pudieron cargar las secciones informativas (site_sections) desde Supabase; se conserva el texto ya escrito en index.html.', err);
    return {};
  }
}

// Inserta un <img> real dentro del contenedor visual de una sección,
// reemplazando el marcador de posición actual (el <span>/.ph-label de
// texto), solo cuando hay una image_url real. Si no hay imagen todavía,
// el marcador de posición se deja exactamente como está — nunca queda un
// espacio vacío.
function applySectionImage(container, imageUrl, imageAlt) {
  if (!container || !imageUrl) return;
  Array.from(container.children).forEach(child => child.remove());
  container.appendChild(el('img', { attrs: { src: imageUrl, alt: imageAlt || '' } }));
}

// Aplica los campos de una fila de site_sections sobre eyebrowEl/titleEl/
// descEl (si el campo llega vacío se deja el texto actual, nunca se borra)
// y sobre visibilityTargets (se ocultan/muestran tal cual si visible es
// false/true). imageContainer es opcional (no todas las secciones futuras
// necesitarán imagen).
function applySiteSection(row, { eyebrowEl, titleEl, descEl, imageContainer, visibilityTargets }) {
  if (!row) return;
  const hide = row.visible === false;
  (visibilityTargets || []).forEach(node => { if (node) node.hidden = hide; });
  if (hide) return;

  if (eyebrowEl && row.eyebrow) eyebrowEl.textContent = row.eyebrow;
  if (titleEl && row.title) titleEl.textContent = row.title;
  if (descEl && row.description) descEl.textContent = row.description;
  applySectionImage(imageContainer, row.image_url, row.image_alt);
}

async function renderSiteSections() {
  const sections = await loadSiteSections();

  // "Cómo personalizamos" — sección propia, independiente (#personalizacion).
  const personalizeSection = document.getElementById('personalizacion');
  if (personalizeSection) {
    applySiteSection(sections['personalizacion'], {
      eyebrowEl: personalizeSection.querySelector('.eyebrow'),
      titleEl: personalizeSection.querySelector('h2'),
      descEl: personalizeSection.querySelector('p'),
      imageContainer: personalizeSection.querySelector('.thread-visual'),
      visibilityTargets: [personalizeSection]
    });
  }

  // "Colección permanente" — NO es una sección propia: es el eyebrow +
  // título + descripción + imagen del hero (la primera sección de la
  // página), que también contiene los botones "Ver colección"/"Cómo
  // personalizamos →" (.hero-actions). Esos botones no son parte de esta
  // fila de site_sections, así que si visible=false solo se ocultan el
  // eyebrow, el título, la descripción y la imagen — el hero no desaparece
  // por completo y los botones siguen ahí.
  const hero = document.querySelector('.hero');
  if (hero) {
    const eyebrowEl = hero.querySelector('.eyebrow');
    const titleEl = hero.querySelector('h1');
    const descEl = hero.querySelector('p.lede');
    const imageContainer = hero.querySelector('.hero-visual');
    applySiteSection(sections['coleccion-permanente'], {
      eyebrowEl,
      titleEl,
      descEl,
      imageContainer,
      visibilityTargets: [eyebrowEl, titleEl, descEl, imageContainer]
    });
  }
}

document.addEventListener('DOMContentLoaded', renderSiteSections);
