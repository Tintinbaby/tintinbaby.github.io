/* admin/js/admin.js
 * Panel administrativo — Etapa 1 + Etapa 2: administración de PRODUCTOS
 * (crear, editar, activar/desactivar, reordenar) y de VARIANTES de producto
 * (product_variants: crear, editar, activar/desactivar, reordenar, cambiar
 * de producto). Las categorías siguen siendo solo de lectura. No se tocan
 * imágenes ni Storage en este archivo — eso queda para una etapa posterior;
 * "image_alt" sí se edita porque es una columna propia de product_variants,
 * no de la tabla images.
 *
 * Reutiliza el cliente que ya expone js/supabase-client.js en
 * window.supabaseClient (misma publishable key que usa el catálogo
 * público) — no se duplica ninguna configuración de Supabase aquí.
 *
 * Flujo de acceso (sin cambios respecto a la etapa anterior):
 *   1. Login con email/contraseña (Supabase Auth).
 *   2. Se confirma que la sesión es administradora llamando a la función
 *      is_admin() vía RPC — NO se consulta la tabla admin_users
 *      directamente: esa tabla tiene RLS habilitado sin ninguna política,
 *      así que una lectura directa siempre devolvería 0 filas, incluso
 *      para el propio administrador. is_admin() es, a propósito, la única
 *      puerta que la base de datos expone para esta comprobación.
 *   3. Si no es administrador: se cierra la sesión y se muestra "acceso
 *      denegado". Si sí lo es: se muestra el panel y se cargan los datos.
 *
 * Toda escritura (crear/editar/activar) pasa por Supabase tal cual —
 * ninguna decisión de "puede o no puede editar" se toma en este archivo;
 * eso lo decide exclusivamente la política RLS admin_all_products del
 * lado del servidor (using/with check is_admin()). Este archivo se limita
 * a mostrar con claridad cuando Supabase rechaza una operación.
 */
(function () {
  'use strict';

  const client = window.supabaseClient;

  // Estado en memoria de lo último cargado — lo usan el formulario de
  // producto (para poblar el selector de categoría y generar el id) y los
  // botones "Editar" (para no tener que volver a pedir la fila a Supabase).
  let currentCategories = [];
  let currentProducts = [];
  let editingProductId = null; // null = el formulario de producto está en modo "crear"
  let editingVariantId = null; // null = el formulario de variante está en modo "crear"
  let currentImagesVariantId = null; // variante cuyo modal de imágenes está abierto (o null si está cerrado)
  let editingImageId = null; // null = el mini-formulario de imagen está en modo "agregar"
  let editingCategoryId = null; // null = el formulario de categorías está en modo "crear" (Etapa 4B); si no, id de la categoría existente que se está editando
  let currentImagesProductId = null; // Etapa 4D: producto cuyo modal de imágenes propias está abierto (o null si está cerrado)
  let editingProductImageId = null; // Etapa 4D: null = el mini-formulario de imagen de producto está en modo "agregar"
  let productIdPendingDelete = null; // Etapa 4D: producto sobre el que se pulsó "Eliminar", pendiente de confirmar
  let variantIdPendingDelete = null; // Etapa 4E: variante sobre la que se pulsó "Eliminar", pendiente de confirmar
  let categoryIdPendingDelete = null; // Etapa 4E: categoría sobre la que se pulsó "Eliminar", pendiente de confirmar
  let currentSiteSections = []; // Etapa 5: filas de site_sections tal como las devolvió Supabase
  let editingSiteSectionKey = null; // Etapa 5: key de la sección cuyo formulario está abierto (siempre "editar" — no hay modo "crear")

  const views = {
    login: document.getElementById('login-view'),
    checking: document.getElementById('checking-view'),
    denied: document.getElementById('denied-view'),
    panel: document.getElementById('panel-view'),
  };
  const logoutBtn = document.getElementById('logout-btn');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const deniedBackBtn = document.getElementById('denied-back-btn');
  const panelError = document.getElementById('panel-error');
  const panelSuccess = document.getElementById('panel-success');

  const newProductBtn = document.getElementById('new-product-btn');
  const productFormOverlay = document.getElementById('product-form-overlay');
  const productForm = document.getElementById('product-form');
  const productFormTitle = document.getElementById('product-form-title');
  const productFormMessage = document.getElementById('product-form-message');
  const productFormCancelBtn = document.getElementById('product-form-cancel');
  const productIdPreview = document.getElementById('product-id-preview');
  const priceAmountRow = document.getElementById('price-amount-row');
  const priceOriginalRow = document.getElementById('price-original-row');
  const productIncludesList = document.getElementById('pf-includes-list');
  const productIncludesAddBtn = document.getElementById('pf-includes-add');

  const newVariantBtn = document.getElementById('new-variant-btn');
  const variantFormOverlay = document.getElementById('variant-form-overlay');
  const variantForm = document.getElementById('variant-form');
  const variantFormTitle = document.getElementById('variant-form-title');
  const variantFormMessage = document.getElementById('variant-form-message');
  const variantFormCancelBtn = document.getElementById('variant-form-cancel');
  const variantIdPreview = document.getElementById('variant-id-preview');
  const variantPriceAmountRow = document.getElementById('variant-price-amount-row');
  const variantPriceOriginalRow = document.getElementById('variant-price-original-row');
  // Etapa 4I: "Qué incluye" propio de la variante — mismo concepto que
  // productIncludesList/productIncludesAddBtn, pero con su propio
  // contenedor (ver funciones renderVariantIncludesRows/addVariantIncludesRow/
  // collectVariantIncludesFromForm más abajo).
  const variantIncludesList = document.getElementById('vf-includes-list');
  const variantIncludesAddBtn = document.getElementById('vf-includes-add');

  const variantImagesOverlay = document.getElementById('variant-images-overlay');
  const variantImagesTitle = document.getElementById('variant-images-title');
  const variantImagesSubtitle = document.getElementById('variant-images-subtitle');
  const variantImagesMessage = document.getElementById('variant-images-message');
  const variantImagesCloseBtn = document.getElementById('variant-images-close');
  const newVariantImageBtn = document.getElementById('new-variant-image-btn');

  const variantImageFormWrap = document.getElementById('variant-image-form-wrap');
  const variantImageForm = document.getElementById('variant-image-form');
  const variantImageFormTitle = document.getElementById('variant-image-form-title');
  const variantImageFormMessage = document.getElementById('variant-image-form-message');
  const variantImageFormProgress = document.getElementById('variant-image-form-progress');
  const variantImageFormCancelBtn = document.getElementById('variant-image-form-cancel');
  const variantImageFileRow = document.getElementById('variant-image-file-row');
  const variantImageFileInput = document.getElementById('vif-file');

  /* ---------- Etapa 4D: imágenes propias del producto + eliminar producto ---------- */
  const productImagesOverlay = document.getElementById('product-images-overlay');
  const productImagesTitle = document.getElementById('product-images-title');
  const productImagesSubtitle = document.getElementById('product-images-subtitle');
  const productImagesMessage = document.getElementById('product-images-message');
  const productImagesCloseBtn = document.getElementById('product-images-close');
  const newProductImageBtn = document.getElementById('new-product-image-btn');

  const productImageFormWrap = document.getElementById('product-image-form-wrap');
  const productImageForm = document.getElementById('product-image-form');
  const productImageFormTitle = document.getElementById('product-image-form-title');
  const productImageFormMessage = document.getElementById('product-image-form-message');
  const productImageFormProgress = document.getElementById('product-image-form-progress');
  const productImageFormCancelBtn = document.getElementById('product-image-form-cancel');
  const productImageFileRow = document.getElementById('product-image-file-row');
  const productImageFileInput = document.getElementById('pif-file');

  const deleteProductOverlay = document.getElementById('delete-product-overlay');
  const deleteProductMessage = document.getElementById('delete-product-message');
  const deleteProductConfirmBtn = document.getElementById('delete-product-confirm');
  const deleteProductCancelBtn = document.getElementById('delete-product-cancel');

  /* ---------- Etapa 4E: eliminar variante / eliminar categoría ---------- */
  const deleteVariantOverlay = document.getElementById('delete-variant-overlay');
  const deleteVariantMessage = document.getElementById('delete-variant-message');
  const deleteVariantConfirmBtn = document.getElementById('delete-variant-confirm');
  const deleteVariantCancelBtn = document.getElementById('delete-variant-cancel');

  const deleteCategoryOverlay = document.getElementById('delete-category-overlay');
  const deleteCategoryMessage = document.getElementById('delete-category-message');
  const deleteCategoryConfirmBtn = document.getElementById('delete-category-confirm');
  const deleteCategoryCancelBtn = document.getElementById('delete-category-cancel');

  const newCategoryBtn = document.getElementById('new-category-btn');
  const categoryFormOverlay = document.getElementById('category-form-overlay');
  const categoryForm = document.getElementById('category-form');
  const categoryFormTitle = document.getElementById('category-form-title');
  const categoryFormMessage = document.getElementById('category-form-message');
  const categoryFormCancelBtn = document.getElementById('category-form-cancel');
  const categoryFormSubmitBtn = document.getElementById('category-form-submit');
  const categoryIdPreview = document.getElementById('category-id-preview');
  const categorySlugPreview = document.getElementById('category-slug-preview');
  const categoryAnchorPreview = document.getElementById('category-anchor-preview');
  const categoryPreviewRow = document.getElementById('category-preview-row');
  const categoryAnchorPreviewRow = document.getElementById('category-anchor-preview-row');
  const categoryIdInputRow = document.getElementById('category-id-input-row');
  const categoryAnchorInputRow = document.getElementById('category-anchor-input-row');
  const categoryIdInput = document.getElementById('cf-id');
  const categorySlugInput = document.getElementById('cf-slug');
  const categoryAnchorInput = document.getElementById('cf-anchor-id');

  /* ---------- Etapa 5: contenido editable de secciones informativas
   * (site_sections) ---------- */
  const siteSectionFormOverlay = document.getElementById('site-section-form-overlay');
  const siteSectionForm = document.getElementById('site-section-form');
  const siteSectionFormTitle = document.getElementById('site-section-form-title');
  const siteSectionKeyPreview = document.getElementById('site-section-key-preview');
  const siteSectionFormMessage = document.getElementById('site-section-form-message');
  const siteSectionFormProgress = document.getElementById('site-section-form-progress');
  const siteSectionFormCancelBtn = document.getElementById('site-section-form-cancel');
  const ssfCurrentImageWrap = document.getElementById('ssf-current-image-wrap');
  const siteSectionImageFileInput = document.getElementById('ssf-image-file');

  const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const CATALOG_IMAGES_BUCKET = 'catalog-images';

  // Etapa 4: únicos valores que el CHECK constraint de supabase/schema.sql
  // acepta actualmente para categories.layout y categories.section_modifier
  // (confirmado por inspección directa del esquema, no inventados). El
  // <select> del formulario solo ofrece estas mismas opciones, y esta
  // validación es una segunda barrera puramente defensiva — la autoridad
  // real sigue siendo el CHECK constraint de la base de datos.
  const ALLOWED_CATEGORY_LAYOUTS = ['simple-grid', 'variant-carousels'];
  const ALLOWED_CATEGORY_SECTION_MODIFIERS = ['alt']; // además de "ninguno" (null)

  function showView(name) {
    Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
    logoutBtn.hidden = name !== 'panel';
  }

  function showLoginError(message) {
    loginError.textContent = message;
    loginError.hidden = false;
  }

  function showPanelError(message) {
    panelSuccess.hidden = true;
    panelError.textContent = message;
    panelError.hidden = false;
  }

  function showPanelSuccess(message) {
    panelError.hidden = true;
    panelSuccess.textContent = message;
    panelSuccess.hidden = false;
  }

  function showPanelMessage(message, isError) {
    if (isError) showPanelError(message);
    else showPanelSuccess(message);
  }

  // Distingue con claridad un rechazo de RLS/permisos de cualquier otro
  // error de Supabase, tal como pide la fase: "si una operación devuelve
  // un error de permisos, debe quedar claro que Supabase rechazó la
  // operación" — nunca se oculta ni se generaliza en silencio.
  function describeSupabaseError(error) {
    const code = error && error.code ? ` (código ${error.code})` : '';
    const msg = (error && error.message) || 'Error desconocido';
    if ((error && error.code === '42501') || /row-level security|permission denied/i.test(msg)) {
      return `Supabase rechazó la operación por permisos (RLS)${code}: ${msg}`;
    }
    if ((error && error.code === '23505') || /duplicate key value|unique constraint/i.test(msg)) {
      // Violación de una restricción UNIQUE (por ejemplo id/slug/anchor_id de
      // categories). Solo debería llegar aquí si la validación previa en el
      // formulario no alcanzó a detectar el duplicado (por ejemplo, otra
      // sesión de administrador creó la misma categoría al mismo tiempo) —
      // de todas formas se muestra un mensaje comprensible en vez del error
      // crudo de Postgres.
      const detail = error && error.details ? ` ${error.details}` : '';
      return `Supabase rechazó la operación porque ya existe un registro con ese mismo valor único (id, slug o anchor_id)${code}:${detail || ` ${msg}`}`;
    }
    if ((error && error.code === '23503') || /foreign key constraint|violates foreign key/i.test(msg)) {
      // Etapa 4E: violación de la restricción "products.category_id
      // references categories(id) on delete restrict" — la única llave
      // foránea RESTRICT de todo el esquema (las demás son CASCADE). En la
      // práctica solo puede llegar aquí un intento de eliminar una categoría
      // que todavía tiene productos, así que se traduce directamente al
      // mismo mensaje amigable que ya se muestra desde la comprobación
      // previa en el cliente (ver handleConfirmDeleteCategory).
      return `${CATEGORY_HAS_PRODUCTS_MESSAGE}${code}: ${msg}`;
    }
    return `Supabase devolvió un error${code}: ${msg}`;
  }

  /* ---------- Formato de precio (versión sencilla, propia del panel) ---------- */
  function formatAmount(amount, currency) {
    if (amount === null || amount === undefined) return '—';
    const rounded = Math.round(Number(amount));
    const withThousands = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const symbol = currency === 'COP' || !currency ? '$' : `${currency} `;
    return `${symbol}${withThousands}`;
  }

  function formatPriceCell(row) {
    if (!row.price_mode) return '—';
    switch (row.price_mode) {
      case 'fixed':
        return formatAmount(row.price_amount, row.price_currency);
      case 'promo':
        return `${formatAmount(row.price_amount, row.price_currency)} (antes ${formatAmount(row.price_original_amount, row.price_currency)})`;
      case 'consult':
        return 'A consultar';
      case 'from':
        return `Desde ${formatAmount(row.price_amount, row.price_currency)}`;
      default:
        return row.price_mode;
    }
  }

  function statusBadge(active) {
    const span = document.createElement('span');
    span.className = active ? 'status-badge status-active' : 'status-badge status-inactive';
    span.textContent = active ? 'Activo' : 'Inactivo';
    return span;
  }

  function cell(text) {
    const td = document.createElement('td');
    td.textContent = (text === null || text === undefined || text === '') ? '—' : String(text);
    return td;
  }

  // Etapa 5: mismo look que statusBadge/statusCell (reutiliza las mismas
  // clases CSS "status-badge status-active/inactive" — sin agregar CSS
  // nuevo), pero con el texto correcto para site_sections.visible en vez
  // de "Activo"/"Inactivo". Se implementa aparte, en paralelo, en vez de
  // generalizar statusBadge con un parámetro de texto — es el mismo
  // criterio ya usado en Etapa 4I para no arriesgar el código de
  // productos/categorías/variantes que ya funciona.
  function visibilityBadge(visible) {
    const span = document.createElement('span');
    span.className = visible ? 'status-badge status-active' : 'status-badge status-inactive';
    span.textContent = visible ? 'Visible' : 'Oculta';
    return span;
  }

  function visibilityCell(visible) {
    const td = document.createElement('td');
    td.appendChild(visibilityBadge(visible));
    return td;
  }

  function statusCell(active) {
    const td = document.createElement('td');
    td.appendChild(statusBadge(active));
    return td;
  }

  function priceModeLabel(mode) {
    switch (mode) {
      case 'fixed': return 'Fijo';
      case 'promo': return 'Promoción';
      case 'consult': return 'A consultar';
      case 'from': return 'Desde';
      default: return mode || '—';
    }
  }

  // Precio de una variante SIN repetir la modalidad (esa ya tiene su propia
  // columna en la tabla de variantes) — a diferencia de formatPriceCell,
  // que sí antepone la modalidad porque en la tabla de productos no hay una
  // columna separada para eso.
  function formatVariantPriceAmountCell(v) {
    switch (v.price_mode) {
      case 'fixed':
        return formatAmount(v.price_amount, v.price_currency);
      case 'promo':
        return `${formatAmount(v.price_amount, v.price_currency)} (antes ${formatAmount(v.price_original_amount, v.price_currency)})`;
      case 'from':
        return v.price_amount === null || v.price_amount === undefined ? '—' : formatAmount(v.price_amount, v.price_currency);
      case 'consult':
      default:
        return '—';
    }
  }

  /* ---------- Render de las listas ---------- */
  // Etapa 4: la tabla de categorías deja de ser solo lectura — gana la
  // columna "Nombre" (nav_label, antes se mostraba por error el heading en
  // esa columna), "Heading" como columna propia, "Productos" (conteo local,
  // sin consulta adicional a Supabase), un checkbox de activar/desactivar
  // (mismo patrón que products/product_variants) y el botón "Editar".
  function renderCategories(categories, productCountByCategory) {
    const tbody = document.querySelector('#categories-table tbody');
    tbody.innerHTML = '';
    categories
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((c) => {
        const tr = document.createElement('tr');
        tr.dataset.categoryId = c.id;
        tr.appendChild(cell(c.order));
        tr.appendChild(cell(c.nav_label));
        tr.appendChild(cell(c.heading));
        tr.appendChild(cell(c.slug));
        tr.appendChild(cell(c.layout));
        tr.appendChild(cell((productCountByCategory && productCountByCategory[c.id]) || 0));

        const activeTd = document.createElement('td');
        const activeCheckbox = document.createElement('input');
        activeCheckbox.type = 'checkbox';
        activeCheckbox.className = 'active-toggle category-active-toggle';
        activeCheckbox.checked = !!c.active;
        activeCheckbox.setAttribute('aria-label', `Activa: ${c.nav_label}`);
        activeTd.appendChild(activeCheckbox);
        tr.appendChild(activeTd);

        const actionsTd = document.createElement('td');
        actionsTd.className = 'actions-cell';
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'edit-category-btn btn-secondary small';
        editBtn.textContent = 'Editar';
        actionsTd.appendChild(editBtn);

        // Etapa 4E: disponible para todas las categorías — si tiene
        // productos asociados, el propio flujo de confirmación avisa antes
        // de intentar el DELETE (ver handleConfirmDeleteCategory).
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-category-btn btn-secondary small';
        deleteBtn.textContent = '🗑️ Eliminar';
        actionsTd.appendChild(deleteBtn);

        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });
  }

  function renderProducts(products, categoryNameById) {
    const tbody = document.querySelector('#products-table tbody');
    tbody.innerHTML = '';
    products
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((p) => {
        const tr = document.createElement('tr');
        tr.dataset.productId = p.id;
        tr.appendChild(cell(p.order));
        tr.appendChild(cell(categoryNameById[p.category_id] || p.category_id));
        tr.appendChild(cell(p.name));
        tr.appendChild(cell(p.badge));
        tr.appendChild(cell(formatPriceCell(p)));
        tr.appendChild(cell((p.product_variants || []).length));

        const activeTd = document.createElement('td');
        const activeCheckbox = document.createElement('input');
        activeCheckbox.type = 'checkbox';
        activeCheckbox.className = 'active-toggle';
        activeCheckbox.checked = !!p.active;
        activeCheckbox.setAttribute('aria-label', `Activo: ${p.name}`);
        activeTd.appendChild(activeCheckbox);
        tr.appendChild(activeTd);

        const actionsTd = document.createElement('td');
        actionsTd.className = 'actions-cell';
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'edit-product-btn btn-secondary small';
        editBtn.textContent = 'Editar';
        actionsTd.appendChild(editBtn);

        // Etapa 4D: disponible para TODOS los productos, tengan o no
        // variantes — así un producto puede tener sus propias fotos sin
        // necesidad de crear una variante solo para eso.
        const imagesBtn = document.createElement('button');
        imagesBtn.type = 'button';
        imagesBtn.className = 'manage-product-images-btn btn-secondary small';
        imagesBtn.textContent = `Imágenes${(p.images || []).length ? ` (${(p.images || []).length})` : ''}`;
        actionsTd.appendChild(imagesBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-product-btn btn-secondary small';
        deleteBtn.textContent = 'Eliminar';
        actionsTd.appendChild(deleteBtn);

        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });
  }

  function renderVariants(products) {
    const tbody = document.querySelector('#variants-table tbody');
    tbody.innerHTML = '';
    products
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((p) => {
        (p.product_variants || [])
          .slice()
          .sort((a, b) => a.order - b.order)
          .forEach((v) => {
            const tr = document.createElement('tr');
            tr.dataset.variantId = v.id;
            tr.appendChild(cell(p.name));
            tr.appendChild(cell(v.name));

            const activeTd = document.createElement('td');
            const activeCheckbox = document.createElement('input');
            activeCheckbox.type = 'checkbox';
            activeCheckbox.className = 'active-toggle variant-active-toggle';
            activeCheckbox.checked = !!v.active;
            activeCheckbox.setAttribute('aria-label', `Activo: ${v.name}`);
            activeTd.appendChild(activeCheckbox);
            tr.appendChild(activeTd);

            tr.appendChild(cell(v.order));
            tr.appendChild(cell(priceModeLabel(v.price_mode)));
            tr.appendChild(cell(formatVariantPriceAmountCell(v)));

            const actionsTd = document.createElement('td');
            actionsTd.className = 'actions-cell';
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'edit-variant-btn btn-secondary small';
            editBtn.textContent = 'Editar';
            actionsTd.appendChild(editBtn);

            const imagesBtn = document.createElement('button');
            imagesBtn.type = 'button';
            imagesBtn.className = 'manage-images-btn btn-secondary small';
            imagesBtn.textContent = `Imágenes${(v.images || []).length ? ` (${(v.images || []).length})` : ''}`;
            actionsTd.appendChild(imagesBtn);

            // Etapa 4E: disponible para todas las variantes, individualmente.
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'delete-variant-btn btn-secondary small';
            deleteBtn.textContent = '🗑️ Eliminar';
            actionsTd.appendChild(deleteBtn);

            tr.appendChild(actionsTd);

            tbody.appendChild(tr);
          });
      });
  }

  // Etapa 5: etiqueta visible en la tabla para cada "key" conocida hoy. Una
  // sección futura (p. ej. "sobre-nosotros") necesitará agregar su propia
  // entrada aquí — es exactamente el pequeño toque de código que ya se
  // documentó en el análisis previo como inevitable (la posición/diseño de
  // cada sección siempre vive en index.html/css, no en la base de datos).
  // Si una key todavía no tiene etiqueta, se muestra la key tal cual.
  const SITE_SECTION_LABELS = {
    'personalizacion': 'Cómo personalizamos',
    'coleccion-permanente': 'Colección permanente',
  };
  // Orden fijo de aparición en la tabla para las keys ya conocidas hoy;
  // cualquier key futura que no esté en esta lista se muestra al final, en
  // el orden en que Supabase la devuelva.
  const SITE_SECTION_ORDER = ['personalizacion', 'coleccion-permanente'];

  function renderSiteSections(sections) {
    const tbody = document.querySelector('#site-sections-table tbody');
    tbody.innerHTML = '';

    const byKey = {};
    (sections || []).forEach((s) => { byKey[s.key] = s; });
    const orderedKeys = [
      ...SITE_SECTION_ORDER.filter((k) => byKey[k]),
      ...Object.keys(byKey).filter((k) => !SITE_SECTION_ORDER.includes(k)),
    ];

    orderedKeys.forEach((key) => {
      const section = byKey[key];
      const tr = document.createElement('tr');
      tr.dataset.sectionKey = key;
      tr.appendChild(cell(SITE_SECTION_LABELS[key] || key));
      tr.appendChild(cell(section.eyebrow));
      tr.appendChild(cell(section.title));
      tr.appendChild(visibilityCell(section.visible !== false));

      const actionsTd = document.createElement('td');
      actionsTd.className = 'actions-cell';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'edit-site-section-btn btn-secondary small';
      editBtn.textContent = 'Editar';
      actionsTd.appendChild(editBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  // Carga aparte de loadPanelData() (más abajo) — a propósito: si
  // site_sections todavía no existe en Supabase (por ejemplo, antes de
  // correr el SQL de esta etapa contra la base de datos real), el resto
  // del panel (categorías/productos/variantes) debe seguir funcionando con
  // normalidad; un error aquí no debe bloquear nada de lo demás.
  async function loadSiteSectionsAdmin() {
    const { data, error } = await client.from('site_sections').select('*');
    if (error) {
      console.error('[admin.js] Error al cargar site_sections:', error);
      showPanelMessage(`No se pudo cargar "Contenido del catálogo": ${describeSupabaseError(error)}`, true);
      currentSiteSections = [];
      renderSiteSections(currentSiteSections);
      return;
    }
    currentSiteSections = data || [];
    renderSiteSections(currentSiteSections);
  }

  // Busca una variante por id recorriendo currentProducts (ya cargado por
  // loadPanelData) — evita una consulta adicional a Supabase solo para
  // abrir el formulario de edición.
  function findVariantById(variantId) {
    for (const p of currentProducts) {
      const v = (p.product_variants || []).find((vv) => vv.id === variantId);
      if (v) return { variant: v, product: p };
    }
    return null;
  }

  // Busca una categoría por id recorriendo currentCategories (ya cargado
  // por loadPanelData) — evita una consulta adicional a Supabase solo para
  // abrir el formulario de edición.
  function findCategoryById(categoryId) {
    return currentCategories.find((c) => c.id === categoryId) || null;
  }

  async function loadPanelData() {
    panelError.hidden = true;

    const [{ data: categories, error: catError }, { data: products, error: prodError }] = await Promise.all([
      client.from('categories').select('*'),
      // Etapa 3: se amplía para traer también las imágenes de cada variante
      // (images(*) anidado dentro de product_variants) — necesarias para la
      // sección "Imágenes de la variante" del panel. Etapa 4D: se agrega
      // además "images(*)" directamente sobre products (imágenes propias del
      // producto, con product_id y variant_id null) — el mismo select que ya
      // usa js/render.js para el catálogo público, así que esto no es un
      // dato nuevo para Supabase, solo faltaba pedirlo también aquí. No
      // cambia nada de lo que ya usaban productos/variantes; solo agrega
      // datos adicionales.
      client.from('products').select('*, images(*), product_variants(*, images(*))'),
    ]);

    if (catError || prodError) {
      console.error('[admin.js] Error al cargar datos del catálogo:', catError || prodError);
      showPanelError('No se pudieron cargar los datos del catálogo. Intenta recargar la página.');
      return;
    }

    // Se guardan en memoria: el formulario de producto los necesita para
    // poblar el selector de categoría (solo activas) y para generar/validar
    // el id de un producto nuevo sin volver a consultar Supabase.
    currentCategories = categories || [];
    currentProducts = products || [];

    const categoryNameById = {};
    currentCategories.forEach((c) => { categoryNameById[c.id] = c.heading; });

    // Etapa 4: cantidad de productos por categoría, para la columna
    // "Productos" de la lista de categorías — cálculo puramente local sobre
    // los datos ya cargados, no agrega ninguna consulta nueva a Supabase.
    const productCountByCategory = {};
    currentProducts.forEach((p) => {
      productCountByCategory[p.category_id] = (productCountByCategory[p.category_id] || 0) + 1;
    });

    renderCategories(currentCategories, productCountByCategory);
    renderProducts(currentProducts, categoryNameById);
    renderVariants(currentProducts);

    // Etapa 5: separado del Promise.all de arriba a propósito — ver el
    // comentario de loadSiteSectionsAdmin().
    await loadSiteSectionsAdmin();
  }

  /* ---------- Utilidades para el id de producto ----------
   * El esquema no genera ids automáticamente (products.id es text primary
   * key, sin default/secuencia/trigger) — los ids existentes son el nombre
   * pasado a minúsculas, sin acentos y con guiones (p. ej. "set-corona",
   * "juego-cuna"). generateUniqueProductId sigue exactamente ese mismo
   * patrón y nunca genera un id al azar (UUID) ni incompatible con el resto
   * del proyecto.
   */
  function slugify(text) {
    return (text || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita acentos (á, é, í, ó, ú, ñ -> n, etc. vía descomposición NFD)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function generateUniqueProductId(name) {
    const base = slugify(name) || 'producto';
    const existingIds = new Set(currentProducts.map((p) => p.id));
    if (!existingIds.has(base)) return base;
    let n = 2;
    while (existingIds.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  /* ---------- Selector de categoría del formulario ---------- */
  function populateCategoryOptions(selectedCategoryId) {
    const select = document.getElementById('pf-category');
    select.innerHTML = '';

    const activeCategories = currentCategories
      .filter((c) => c.active === true)
      .slice()
      .sort((a, b) => a.order - b.order);

    activeCategories.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.heading;
      select.appendChild(opt);
    });

    // Caso límite: si el producto que se está editando pertenece a una
    // categoría que ya no está activa, se agrega igual como opción (para no
    // cambiarle la categoría sin que el administrador lo decida a
    // propósito) pero marcada como inactiva. Nunca se ofrece una categoría
    // que no exista realmente en public.categories.
    if (selectedCategoryId && !activeCategories.some((c) => c.id === selectedCategoryId)) {
      const inactiveCategory = currentCategories.find((c) => c.id === selectedCategoryId);
      if (inactiveCategory) {
        const opt = document.createElement('option');
        opt.value = inactiveCategory.id;
        opt.textContent = `${inactiveCategory.heading} (inactiva)`;
        select.appendChild(opt);
      }
    }

    if (selectedCategoryId) {
      select.value = selectedCategoryId;
    } else if (activeCategories.length > 0) {
      select.value = activeCategories[0].id;
    }
  }

  /* ---------- Etapa 4C: filas editables de products.includes ----------
   * products.includes es jsonb not null default '[]'::jsonb (confirmado en
   * supabase/schema.sql) — Supabase/PostgREST ya lo entrega como un array
   * de strings normal (no como texto JSON que haya que parsear a mano), y
   * así lo consume también js/render.js (product.includes.forEach(...)).
   * Estas funciones solo manejan las filas del formulario; el saneamiento
   * (trim + descartar vacíos) ocurre en collectIncludesFromForm(), al
   * guardar — nunca al escribir, para no interrumpir al administrador
   * mientras escribe.
   */
  function createIncludesRow(value) {
    const row = document.createElement('div');
    row.className = 'includes-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'includes-item-input';
    input.placeholder = 'Elemento incluido';
    input.value = value || '';
    row.appendChild(input);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-secondary small includes-remove-btn';
    removeBtn.textContent = 'Eliminar';
    row.appendChild(removeBtn);

    return row;
  }

  // Reconstruye las filas desde cero a partir de un array — se usa tanto al
  // abrir "Editar" (con los elementos ya guardados) como al abrir "Nuevo
  // producto" (con un array vacío), así el formulario siempre arranca
  // reflejando exactamente los datos reales, sin arrastrar filas de una
  // apertura anterior.
  function renderIncludesRows(items) {
    productIncludesList.innerHTML = '';
    (Array.isArray(items) ? items : []).forEach((item) => {
      productIncludesList.appendChild(createIncludesRow(item));
    });
  }

  function addIncludesRow() {
    productIncludesList.appendChild(createIncludesRow(''));
  }

  // Lee el estado actual del formulario (no un estado en memoria aparte):
  // el orden visual de las filas ES el orden que se guarda, agregar agrega
  // al final, y eliminar una fila la quita de aquí — nunca hace ninguna
  // llamada a Supabase por sí sola.
  function collectIncludesFromForm() {
    return Array.from(productIncludesList.querySelectorAll('.includes-item-input'))
      .map((input) => input.value.trim())
      .filter((value) => value.length > 0);
  }

  /* ---------- Etapa 4I: filas editables de product_variants.includes ----------
   * Mismo mecanismo que las tres funciones de arriba, para la lista propia
   * de la variante — product_variants.includes es jsonb not null default
   * '[]'::jsonb, igual que products.includes (ver supabase/schema.sql).
   *
   * Se implementan como funciones PARALELAS a las de producto (en vez de
   * generalizar renderIncludesRows/addIncludesRow/collectIncludesFromForm
   * con un parámetro de contenedor) a propósito: así el flujo de producto
   * no se toca en absoluto y no hay riesgo de regresión sobre código ya
   * aprobado. createIncludesRow() en cambio SÍ se reutiliza tal cual sin
   * ningún cambio — no depende de ningún contenedor específico, ya recibe
   * un valor y devuelve una fila, así que duplicarla no aportaría nada.
   */
  function renderVariantIncludesRows(items) {
    variantIncludesList.innerHTML = '';
    (Array.isArray(items) ? items : []).forEach((item) => {
      variantIncludesList.appendChild(createIncludesRow(item));
    });
  }

  function addVariantIncludesRow() {
    variantIncludesList.appendChild(createIncludesRow(''));
  }

  function collectVariantIncludesFromForm() {
    return Array.from(variantIncludesList.querySelectorAll('.includes-item-input'))
      .map((input) => input.value.trim())
      .filter((value) => value.length > 0);
  }

  /* ---------- Abrir/cerrar el formulario de producto ---------- */
  function openProductForm(mode, product) {
    productFormMessage.hidden = true;
    productForm.reset();
    editingProductId = mode === 'edit' ? product.id : null;

    if (mode === 'edit') {
      productFormTitle.textContent = `Editar producto: ${product.name}`;
      productIdPreview.textContent = product.id;
      populateCategoryOptions(product.category_id);
      document.getElementById('pf-name').value = product.name || '';
      document.getElementById('pf-order').value = product.order;
      document.getElementById('pf-active').checked = !!product.active;
      document.getElementById('pf-featured').checked = !!product.featured;
      document.getElementById('pf-badge').value = product.badge || '';
      document.getElementById('pf-description').value = product.description || '';
      renderIncludesRows(product.includes);
      document.getElementById('pf-complete-label').value = product.complete_label || '';
      document.getElementById('pf-cta-label').value = product.cta_label || '';
      document.getElementById('pf-cta-href').value = product.cta_href || '';
      document.getElementById('pf-price-mode').value = product.price_mode || '';
      document.getElementById('pf-price-amount').value = product.price_amount === null || product.price_amount === undefined ? '' : product.price_amount;
      document.getElementById('pf-price-original').value = product.price_original_amount === null || product.price_original_amount === undefined ? '' : product.price_original_amount;
      document.getElementById('pf-price-currency').value = product.price_currency || 'COP';
    } else {
      productFormTitle.textContent = 'Nuevo producto';
      productIdPreview.textContent = '(se genera al escribir el nombre)';
      populateCategoryOptions();
      document.getElementById('pf-active').checked = true;
      document.getElementById('pf-featured').checked = false;
      document.getElementById('pf-order').value = 0;
      renderIncludesRows([]);
      document.getElementById('pf-price-currency').value = 'COP';
    }

    updatePriceFieldsVisibility();
    productFormOverlay.hidden = false;
  }

  function closeProductForm() {
    productFormOverlay.hidden = true;
    editingProductId = null;
    productForm.reset();
    productIncludesList.innerHTML = '';
  }

  /* ---------- Campos de precio: visibilidad + validación ----------
   * La validación de aquí es un espejo de las restricciones CHECK que están
   * confirmadas en el supabase/schema.sql local (chk_products_price_fixed /
   * _promo / _consult). Es solo una ayuda para el administrador — la
   * autoridad real sigue siendo la base de datos: si Supabase rechaza el
   * guardado igual, el error real se muestra tal cual (ver
   * describeSupabaseError).
   */
  function updatePriceFieldsVisibility() {
    const mode = document.getElementById('pf-price-mode').value;
    const showAmount = mode === 'fixed' || mode === 'promo' || mode === 'from';
    const showOriginal = mode === 'promo';
    priceAmountRow.hidden = !showAmount;
    priceOriginalRow.hidden = !showOriginal;
  }

  function validatePriceFields(mode, amount, original) {
    if (mode === 'fixed' && amount === null) {
      return 'El modo de precio "Fijo" requiere un monto.';
    }
    if (mode === 'promo' && (amount === null || original === null)) {
      return 'El modo de precio "Promoción" requiere el monto y el monto original.';
    }
    if (mode === 'consult' && (amount !== null || original !== null)) {
      return 'El modo de precio "A consultar" no debe tener montos.';
    }
    return null;
  }

  /* ---------- Guardar (crear/editar) ----------
   * IMPORTANTE: el payload solo incluye columnas reales de products dentro
   * del alcance de la Etapa 1 más "includes" (Etapa 4C). Nunca se toca
   * product_variants, images, ni ninguna otra tabla desde este formulario.
   * Toda la autorización la decide la política RLS admin_all_products del
   * lado de Supabase — aquí solo se interpretan sus resultados (error, o 0
   * filas afectadas).
   *
   * "includes" SIEMPRE viaja como array (nunca null/undefined): incluso si
   * el administrador no toca esa sección, collectIncludesFromForm() lee las
   * filas que openProductForm ya precargó y devuelve ese mismo array (o
   * [] si el producto no tenía elementos) — así nunca se sobrescribe con
   * null por accidente, y una lista vacía se guarda como [] (el mismo
   * formato que ya usa la columna, jsonb not null default '[]'::jsonb).
   */
  async function handleProductFormSubmit(e) {
    e.preventDefault();
    productFormMessage.hidden = true;

    const name = document.getElementById('pf-name').value.trim();
    const categoryId = document.getElementById('pf-category').value;
    const order = parseInt(document.getElementById('pf-order').value, 10);
    const active = document.getElementById('pf-active').checked;
    const featured = document.getElementById('pf-featured').checked;
    const badge = document.getElementById('pf-badge').value.trim() || null;
    const description = document.getElementById('pf-description').value.trim() || null;
    const includes = collectIncludesFromForm();
    const completeLabel = document.getElementById('pf-complete-label').value.trim() || null;
    const ctaLabel = document.getElementById('pf-cta-label').value.trim() || null;
    const ctaHref = document.getElementById('pf-cta-href').value.trim() || null;
    const priceMode = document.getElementById('pf-price-mode').value || null;
    const priceAmountRaw = document.getElementById('pf-price-amount').value;
    const priceOriginalRaw = document.getElementById('pf-price-original').value;
    const priceCurrency = document.getElementById('pf-price-currency').value.trim() || 'COP';

    if (!name) {
      productFormMessage.textContent = 'El nombre es obligatorio.';
      productFormMessage.hidden = false;
      return;
    }
    if (!categoryId) {
      productFormMessage.textContent = 'Selecciona una categoría.';
      productFormMessage.hidden = false;
      return;
    }
    if (Number.isNaN(order) || order < 0) {
      productFormMessage.textContent = 'El orden debe ser un número mayor o igual a 0.';
      productFormMessage.hidden = false;
      return;
    }

    const priceAmount = !priceAmountRow.hidden && priceAmountRaw !== '' ? Number(priceAmountRaw) : null;
    const priceOriginal = !priceOriginalRow.hidden && priceOriginalRaw !== '' ? Number(priceOriginalRaw) : null;

    const priceError = validatePriceFields(priceMode, priceAmount, priceOriginal);
    if (priceError) {
      productFormMessage.textContent = priceError;
      productFormMessage.hidden = false;
      return;
    }

    const payload = {
      name,
      category_id: categoryId,
      order,
      active,
      featured,
      badge,
      description,
      includes,
      complete_label: completeLabel,
      cta_label: ctaLabel,
      cta_href: ctaHref,
      price_mode: priceMode,
      price_amount: priceAmount,
      price_original_amount: priceOriginal,
      price_currency: priceCurrency,
    };

    const saveBtn = productForm.querySelector('button[type=submit]');
    saveBtn.disabled = true;

    try {
      if (editingProductId) {
        const { data, error } = await client
          .from('products')
          .update(payload)
          .eq('id', editingProductId)
          .select();

        if (error) {
          showPanelMessage(describeSupabaseError(error), true);
          return;
        }
        if (!data || data.length === 0) {
          // Una política RLS de UPDATE que excluye la fila no lanza error:
          // simplemente actualiza 0 filas. Hay que detectarlo a mano para no
          // ocultar un rechazo de permisos como si nada hubiera pasado.
          showPanelMessage('Supabase no aplicó ningún cambio (0 filas afectadas). Es probable que la política de seguridad (RLS) haya rechazado la operación.', true);
          return;
        }
        showPanelMessage(`Producto "${name}" (id: ${editingProductId}) actualizado correctamente.`, false);
      } else {
        const newId = generateUniqueProductId(name);
        const { data, error } = await client
          .from('products')
          .insert({ id: newId, ...payload })
          .select();

        if (error) {
          showPanelMessage(describeSupabaseError(error), true);
          return;
        }
        if (!data || data.length === 0) {
          showPanelMessage('Supabase no devolvió el producto creado. Es probable que la política de seguridad (RLS) haya rechazado la operación.', true);
          return;
        }
        showPanelMessage(`Producto "${name}" creado correctamente con id "${newId}".`, false);
      }

      closeProductForm();
      await loadPanelData();
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ---------- Activar/desactivar rápido desde la lista ---------- */
  async function handleToggleActive(productId, newActive, checkboxEl) {
    checkboxEl.disabled = true;

    const { data, error } = await client
      .from('products')
      .update({ active: newActive })
      .eq('id', productId)
      .select();

    if (error) {
      checkboxEl.checked = !newActive;
      showPanelMessage(describeSupabaseError(error), true);
      checkboxEl.disabled = false;
      return;
    }
    if (!data || data.length === 0) {
      checkboxEl.checked = !newActive;
      showPanelMessage('Supabase no aplicó el cambio (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.', true);
      checkboxEl.disabled = false;
      return;
    }

    const updatedName = data[0].name;
    showPanelMessage(`Producto "${updatedName}" marcado como ${newActive ? 'activo' : 'inactivo'}.`, false);
    const idx = currentProducts.findIndex((p) => p.id === productId);
    if (idx !== -1) currentProducts[idx].active = newActive;
    checkboxEl.disabled = false;
  }

  /* ============================================================
   * ETAPA 2 — Gestión de variantes (product_variants)
   * Mismo patrón que la Etapa 1: el formulario solo maneja columnas
   * reales de product_variants, nunca toca products/images/categories,
   * y toda la autorización la decide la política RLS admin_all_variants
   * del lado de Supabase (using/with check is_admin()) — este archivo
   * solo interpreta y muestra con claridad lo que Supabase responde.
   * ============================================================ */

  /* ---------- Id de variante ----------
   * Mismo patrón que los ids existentes: "{idDelProducto}--{nombre en
   * minúsculas, sin acentos, con guiones}" (p. ej. "juego-cuna--diseno-
   * clasico"). Reutiliza slugify(), ya definido para productos.
   */
  function generateUniqueVariantId(productId, name) {
    const base = `${productId}--${slugify(name) || 'variante'}`;
    const existingIds = new Set(
      currentProducts.flatMap((p) => (p.product_variants || []).map((v) => v.id))
    );
    if (!existingIds.has(base)) return base;
    let n = 2;
    while (existingIds.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  /* ---------- Selector de producto del formulario de variante ----------
   * Se construye solo con los productos que realmente se cargaron desde
   * public.products — nunca se ofrece un producto inexistente. A
   * diferencia del selector de categoría de la Etapa 1, aquí sí se listan
   * también los productos inactivos (marcados como tal): una variante
   * puede pertenecer a un producto inactivo y el administrador debe poder
   * verlo/reasignarlo sin quedar bloqueado.
   */
  function populateProductOptionsForVariant(selectedProductId) {
    const select = document.getElementById('vf-product');
    select.innerHTML = '';

    currentProducts
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.active ? p.name : `${p.name} (inactivo)`;
        select.appendChild(opt);
      });

    if (selectedProductId) {
      select.value = selectedProductId;
    }
  }

  function refreshVariantIdPreview() {
    if (editingVariantId || variantFormOverlay.hidden) return;
    const productId = document.getElementById('vf-product').value;
    const name = document.getElementById('vf-name').value;
    variantIdPreview.textContent = (productId && name.trim())
      ? generateUniqueVariantId(productId, name)
      : '(se genera al elegir el producto y escribir el nombre)';
  }

  /* ---------- Abrir/cerrar el formulario de variante ---------- */
  function openVariantForm(mode, variant) {
    variantFormMessage.hidden = true;
    variantForm.reset();
    editingVariantId = mode === 'edit' ? variant.id : null;

    populateProductOptionsForVariant(mode === 'edit' ? variant.product_id : undefined);

    if (mode === 'edit') {
      variantFormTitle.textContent = `Editar variante: ${variant.name}`;
      variantIdPreview.textContent = variant.id;
      document.getElementById('vf-name').value = variant.name || '';
      document.getElementById('vf-order').value = variant.order;
      document.getElementById('vf-active').checked = !!variant.active;
      document.getElementById('vf-description').value = variant.description || '';
      renderVariantIncludesRows(variant.includes);
      document.getElementById('vf-image-alt').value = variant.image_alt || '';
      document.getElementById('vf-placeholder-tone').value = variant.placeholder_tone || '';
      document.getElementById('vf-cta-label').value = variant.cta_label || '';
      document.getElementById('vf-cta-href').value = variant.cta_href || '';
      document.getElementById('vf-price-mode').value = variant.price_mode || '';
      document.getElementById('vf-price-amount').value = variant.price_amount === null || variant.price_amount === undefined ? '' : variant.price_amount;
      document.getElementById('vf-price-original').value = variant.price_original_amount === null || variant.price_original_amount === undefined ? '' : variant.price_original_amount;
      document.getElementById('vf-price-currency').value = variant.price_currency || 'COP';
    } else {
      variantFormTitle.textContent = 'Nueva variante';
      variantIdPreview.textContent = '(se genera al elegir el producto y escribir el nombre)';
      renderVariantIncludesRows([]);
      document.getElementById('vf-active').checked = true;
      document.getElementById('vf-order').value = 0;
      document.getElementById('vf-price-currency').value = 'COP';
      document.getElementById('vf-placeholder-tone').value = '';
      document.getElementById('vf-price-mode').value = '';
    }

    updateVariantPriceFieldsVisibility();
    variantFormOverlay.hidden = false;
  }

  function closeVariantForm() {
    variantFormOverlay.hidden = true;
    editingVariantId = null;
    variantForm.reset();
    variantIncludesList.innerHTML = '';
  }

  /* ---------- Etapa 5: abrir/cerrar el formulario de "Contenido del
   * catálogo" (site_sections) ----------
   * No hay modo "crear": este formulario siempre edita una fila que ya
   * existe (ver renderSiteSections/loadSiteSectionsAdmin) — por eso, a
   * diferencia de openProductForm/openVariantForm, no recibe un "mode".
   */
  function openSiteSectionForm(section) {
    siteSectionFormMessage.hidden = true;
    siteSectionForm.reset();
    editingSiteSectionKey = section.key;

    siteSectionFormTitle.textContent = `Editar: ${SITE_SECTION_LABELS[section.key] || section.key}`;
    siteSectionKeyPreview.textContent = section.key;
    document.getElementById('ssf-eyebrow').value = section.eyebrow || '';
    document.getElementById('ssf-title').value = section.title || '';
    document.getElementById('ssf-description').value = section.description || '';
    document.getElementById('ssf-image-alt').value = section.image_alt || '';
    document.getElementById('ssf-visible').checked = section.visible !== false;

    ssfCurrentImageWrap.innerHTML = '';
    if (section.image_url) {
      const img = document.createElement('img');
      img.src = section.image_url;
      img.alt = section.image_alt || '';
      ssfCurrentImageWrap.appendChild(img);
    } else {
      ssfCurrentImageWrap.textContent = 'Todavía no hay una imagen subida para esta sección.';
    }

    siteSectionFormOverlay.hidden = false;
  }

  function closeSiteSectionForm() {
    siteSectionFormOverlay.hidden = true;
    editingSiteSectionKey = null;
    siteSectionForm.reset();
    ssfCurrentImageWrap.innerHTML = '';
  }

  /* ---------- Etapa 5: guardar "Contenido del catálogo" ----------
   * Reutiliza tal cual (sin ningún cambio) CATALOG_IMAGES_BUCKET,
   * validateImageFile y describeStorageError — las mismas piezas genéricas
   * que ya usan los flujos de imágenes de producto/variante. La subida en
   * sí (upload + getPublicUrl) también sigue el mismo patrón exacto que
   * esos dos flujos, adaptado a que aquí la URL resultante se guarda
   * directo en site_sections.image_url (una sola imagen por sección) en
   * vez de insertarse como una fila nueva en la tabla "images" (que está
   * pensada para galerías de varias imágenes, no aplica aquí).
   *
   * La imagen es opcional en cada guardado: si no se elige un archivo
   * nuevo, image_url no se toca (se conserva la que ya había).
   */
  async function handleSiteSectionFormSubmit(e) {
    e.preventDefault();
    siteSectionFormMessage.hidden = true;
    const submitBtn = document.getElementById('site-section-form-submit');
    submitBtn.disabled = true;

    try {
      const key = editingSiteSectionKey;
      const payload = {
        eyebrow: document.getElementById('ssf-eyebrow').value.trim(),
        title: document.getElementById('ssf-title').value.trim(),
        description: document.getElementById('ssf-description').value.trim(),
        image_alt: document.getElementById('ssf-image-alt').value.trim(),
        visible: document.getElementById('ssf-visible').checked,
      };

      const file = siteSectionImageFileInput.files && siteSectionImageFileInput.files[0];
      if (file) {
        const fileError = validateImageFile(file);
        if (fileError) {
          siteSectionFormMessage.textContent = fileError;
          siteSectionFormMessage.hidden = false;
          return;
        }

        siteSectionFormProgress.hidden = false;
        const path = buildSiteSectionImageStoragePath(key, file);

        const { error: uploadError } = await client.storage
          .from(CATALOG_IMAGES_BUCKET)
          .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });

        if (uploadError) {
          siteSectionFormProgress.hidden = true;
          siteSectionFormMessage.textContent = describeStorageError(uploadError);
          siteSectionFormMessage.hidden = false;
          return;
        }

        const { data: publicUrlData } = client.storage.from(CATALOG_IMAGES_BUCKET).getPublicUrl(path);
        const publicUrl = publicUrlData && publicUrlData.publicUrl;
        siteSectionFormProgress.hidden = true;

        if (!publicUrl) {
          siteSectionFormMessage.textContent = `La imagen se subió a Storage en la ruta "${path}" pero no se pudo construir su URL pública. Revisa la configuración del bucket "${CATALOG_IMAGES_BUCKET}".`;
          siteSectionFormMessage.hidden = false;
          return;
        }

        // La imagen anterior (si existía) queda huérfana en Storage — misma
        // limitación ya aceptada y documentada para imágenes de productos y
        // variantes (no hay política de DELETE sobre el bucket, a propósito).
        payload.image_url = publicUrl;
      }

      const { data: updatedRows, error: updateError } = await client
        .from('site_sections')
        .update(payload)
        .eq('key', key)
        .select();

      if (updateError) {
        siteSectionFormMessage.textContent = describeSupabaseError(updateError);
        siteSectionFormMessage.hidden = false;
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        siteSectionFormMessage.textContent = 'Supabase no devolvió el registro actualizado — probablemente la política de seguridad (RLS) rechazó la operación.';
        siteSectionFormMessage.hidden = false;
        return;
      }

      showPanelMessage('Sección actualizada correctamente.', false);
      closeSiteSectionForm();
      await loadSiteSectionsAdmin();
    } finally {
      submitBtn.disabled = false;
    }
  }

  /* ---------- Campos de precio de variante ----------
   * A diferencia de products, en product_variants price_mode es NOT NULL
   * (obligatorio) — por eso el <select> del formulario no tiene una opción
   * "sin precio propio" y lleva el atributo required. Las reglas que se
   * validan aquí son exactamente las que ya existen en Supabase para esta
   * tabla (indicadas explícitamente para esta etapa): "consult" exige
   * ambos montos en NULL; "fixed" exige que exista el monto; "promo" exige
   * que existan monto y monto original; "from" no tiene una restricción
   * propia — se maneja igual que ya lo hace el catálogo (monto opcional).
   * No se inventa ninguna regla adicional a las de Supabase.
   */
  function updateVariantPriceFieldsVisibility() {
    const mode = document.getElementById('vf-price-mode').value;
    const showAmount = mode === 'fixed' || mode === 'promo' || mode === 'from';
    const showOriginal = mode === 'promo';
    variantPriceAmountRow.hidden = !showAmount;
    variantPriceOriginalRow.hidden = !showOriginal;
  }

  function validateVariantPriceFields(mode, amount, original) {
    if (!mode) {
      return 'El modo de precio es obligatorio en las variantes.';
    }
    if (mode === 'fixed' && amount === null) {
      return 'El modo de precio "Fijo" requiere un monto.';
    }
    if (mode === 'promo' && (amount === null || original === null)) {
      return 'El modo de precio "Promoción" requiere el monto y el monto original.';
    }
    if (mode === 'consult' && (amount !== null || original !== null)) {
      return 'El modo de precio "A consultar" no debe tener montos.';
    }
    return null;
  }

  /* ---------- Guardar variante (crear/editar) ----------
   * El payload solo incluye columnas reales de product_variants. Nunca se
   * toca products, images, categories ni ninguna otra tabla desde aquí.
   */
  async function handleVariantFormSubmit(e) {
    e.preventDefault();
    variantFormMessage.hidden = true;

    const productId = document.getElementById('vf-product').value;
    const name = document.getElementById('vf-name').value.trim();
    const order = parseInt(document.getElementById('vf-order').value, 10);
    const active = document.getElementById('vf-active').checked;
    const description = document.getElementById('vf-description').value.trim() || null;
    const includes = collectVariantIncludesFromForm();
    // image_alt es NOT NULL con default '' en la tabla — nunca se envía null.
    const imageAlt = document.getElementById('vf-image-alt').value.trim();
    const placeholderTone = document.getElementById('vf-placeholder-tone').value || null;
    const ctaLabel = document.getElementById('vf-cta-label').value.trim() || null;
    const ctaHref = document.getElementById('vf-cta-href').value.trim() || null;
    const priceMode = document.getElementById('vf-price-mode').value || null;
    const priceAmountRaw = document.getElementById('vf-price-amount').value;
    const priceOriginalRaw = document.getElementById('vf-price-original').value;
    const priceCurrency = document.getElementById('vf-price-currency').value.trim() || 'COP';

    if (!productId) {
      variantFormMessage.textContent = 'Selecciona el producto al que pertenece esta variante.';
      variantFormMessage.hidden = false;
      return;
    }
    if (!name) {
      variantFormMessage.textContent = 'El nombre de la variante es obligatorio.';
      variantFormMessage.hidden = false;
      return;
    }
    if (Number.isNaN(order) || order < 0) {
      variantFormMessage.textContent = 'El orden debe ser un número mayor o igual a 0.';
      variantFormMessage.hidden = false;
      return;
    }

    const priceAmount = !variantPriceAmountRow.hidden && priceAmountRaw !== '' ? Number(priceAmountRaw) : null;
    const priceOriginal = !variantPriceOriginalRow.hidden && priceOriginalRaw !== '' ? Number(priceOriginalRaw) : null;

    const priceError = validateVariantPriceFields(priceMode, priceAmount, priceOriginal);
    if (priceError) {
      variantFormMessage.textContent = priceError;
      variantFormMessage.hidden = false;
      return;
    }

    const payload = {
      product_id: productId,
      order,
      active,
      name,
      description,
      includes,
      image_alt: imageAlt,
      placeholder_tone: placeholderTone,
      cta_label: ctaLabel,
      cta_href: ctaHref,
      price_mode: priceMode,
      price_amount: priceAmount,
      price_original_amount: priceOriginal,
      price_currency: priceCurrency,
    };

    const saveBtn = variantForm.querySelector('button[type=submit]');
    saveBtn.disabled = true;

    try {
      if (editingVariantId) {
        const { data, error } = await client
          .from('product_variants')
          .update(payload)
          .eq('id', editingVariantId)
          .select();

        if (error) {
          showPanelMessage(describeSupabaseError(error), true);
          return;
        }
        if (!data || data.length === 0) {
          showPanelMessage('Supabase no aplicó ningún cambio (0 filas afectadas). Es probable que la política de seguridad (RLS) haya rechazado la operación.', true);
          return;
        }
        showPanelMessage(`Variante "${name}" (id: ${editingVariantId}) actualizada correctamente.`, false);
      } else {
        const newId = generateUniqueVariantId(productId, name);
        const { data, error } = await client
          .from('product_variants')
          .insert({ id: newId, ...payload })
          .select();

        if (error) {
          showPanelMessage(describeSupabaseError(error), true);
          return;
        }
        if (!data || data.length === 0) {
          showPanelMessage('Supabase no devolvió la variante creada. Es probable que la política de seguridad (RLS) haya rechazado la operación.', true);
          return;
        }
        showPanelMessage(`Variante "${name}" creada correctamente con id "${newId}".`, false);
      }

      closeVariantForm();
      await loadPanelData();
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ---------- Activar/desactivar rápido desde la lista de variantes ---------- */
  function updateLocalVariantActive(variantId, newActive) {
    for (const p of currentProducts) {
      const v = (p.product_variants || []).find((vv) => vv.id === variantId);
      if (v) { v.active = newActive; break; }
    }
  }

  async function handleToggleVariantActive(variantId, newActive, checkboxEl) {
    checkboxEl.disabled = true;

    const { data, error } = await client
      .from('product_variants')
      .update({ active: newActive })
      .eq('id', variantId)
      .select();

    if (error) {
      checkboxEl.checked = !newActive;
      showPanelMessage(describeSupabaseError(error), true);
      checkboxEl.disabled = false;
      return;
    }
    if (!data || data.length === 0) {
      checkboxEl.checked = !newActive;
      showPanelMessage('Supabase no aplicó el cambio (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.', true);
      checkboxEl.disabled = false;
      return;
    }

    const updatedName = data[0].name;
    showPanelMessage(`Variante "${updatedName}" marcada como ${newActive ? 'activa' : 'inactiva'}.`, false);
    updateLocalVariantActive(variantId, newActive);
    checkboxEl.disabled = false;
  }

  /* ============================================================
   * ETAPA 3 — Imágenes de variantes (tabla images, variant_id)
   * Mismo patrón de autorización que el resto del panel: toda escritura
   * pasa tal cual por Supabase (tabla images o el bucket de Storage) y la
   * decisión real de "puede o no puede" la toman la política RLS
   * admin_all_images (using/with check is_admin()) y la política de
   * Storage admin_upload_catalog_images (WITH CHECK bucket_id =
   * 'catalog-images' AND public.is_admin()) — ninguna de las dos se toca
   * ni se crea ninguna nueva aquí. Este archivo solo llama a Supabase e
   * interpreta con claridad lo que responde.
   *
   * Alcance de esta etapa: subir un archivo nuevo (crear), editar los
   * metadatos de una imagen existente (alt/orden/activa/principal),
   * activar/desactivar, y marcar como principal. NO se implementa
   * reemplazar el archivo de una imagen existente ni eliminación física
   * (ni de la fila en images ni del objeto en Storage — de hecho no hay
   * política de DELETE sobre el bucket, así que ni sería posible).
   * ============================================================ */

  function describeStorageError(error) {
    const msg = (error && error.message) || 'Error desconocido';
    const code = error && (error.statusCode || error.status) ? ` (código ${error.statusCode || error.status})` : '';
    if (/row-level security|permission denied|not authorized|unauthorized/i.test(msg)) {
      return `Supabase Storage rechazó la operación por permisos (RLS)${code}: ${msg}`;
    }
    return `Supabase Storage devolvió un error${code}: ${msg}`;
  }

  // Validación en el cliente — es solo una ayuda para el administrador. La
  // restricción real (tipo de archivo, tamaño máximo) ya la aplica el
  // propio bucket del lado de Supabase; si algo se cuela aquí, el error
  // real de Storage se muestra igual (describeStorageError), nunca se
  // oculta.
  function validateImageFile(file) {
    if (!file) return 'Selecciona un archivo de imagen.';
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
      return `Tipo de archivo no permitido (${file.type || 'desconocido'}). Solo se aceptan JPEG, PNG o WebP.`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `El archivo pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB — el máximo permitido es 5 MB.`;
    }
    return null;
  }

  // Ruta única dentro del bucket: variants/{variantId}/{timestamp}-{slug}.ext
  // — siempre única (por el timestamp), así que nunca hace falta upsert.
  function buildVariantImageStoragePath(variantId, file) {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0
      ? file.name.slice(dot + 1).toLowerCase()
      : (file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg');
    const baseName = dot >= 0 ? file.name.slice(0, dot) : file.name;
    const slug = slugify(baseName) || 'imagen';
    return `variants/${variantId}/${Date.now()}-${slug}.${ext}`;
  }

  // Etapa 5: mismo patrón exacto que buildVariantImageStoragePath/
  // buildProductImageStoragePath (más abajo) — ruta única dentro del mismo
  // bucket "catalog-images" (no se creó ningún bucket ni política nueva de
  // Storage: la política admin_upload_catalog_images ya existente no está
  // limitada por prefijo de ruta, así que "sections/..." queda cubierta sin
  // ningún cambio).
  function buildSiteSectionImageStoragePath(key, file) {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0
      ? file.name.slice(dot + 1).toLowerCase()
      : (file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg');
    const baseName = dot >= 0 ? file.name.slice(0, dot) : file.name;
    const slug = slugify(baseName) || 'imagen';
    return `sections/${key}/${Date.now()}-${slug}.${ext}`;
  }

  function findImageById(variantId, imageId) {
    const found = findVariantById(variantId);
    if (!found) return null;
    return (found.variant.images || []).find((img) => img.id === imageId) || null;
  }

  /* ---------- Marcar como principal ----------
   * Nunca se inserta una imagen con is_primary: true directamente. Para
   * marcar una como principal se hacen SIEMPRE dos escrituras, en este
   * orden: primero se apaga cualquier otra imagen principal de la misma
   * variante, y solo después se enciende la elegida. El orden importa: la
   * base de datos ya tiene un índice único parcial
   * (uq_images_one_primary_per_variant) que impide que dos imágenes de la
   * misma variante tengan is_primary = true a la vez — no se crea ninguna
   * restricción nueva, se respeta la que ya existe haciendo los cambios en
   * el orden que ella exige.
   */
  async function setPrimaryImage(variantId, imageId) {
    const { error: unsetError } = await client
      .from('images')
      .update({ is_primary: false })
      .eq('variant_id', variantId)
      .eq('is_primary', true)
      .neq('id', imageId)
      .select();

    if (unsetError) {
      return { ok: false, error: unsetError };
    }

    const { data, error: setError } = await client
      .from('images')
      .update({ is_primary: true })
      .eq('id', imageId)
      .select();

    if (setError) {
      return { ok: false, error: setError };
    }
    if (!data || data.length === 0) {
      return { ok: false, error: null };
    }
    return { ok: true, data };
  }

  /* ---------- Lista de imágenes dentro del modal ---------- */
  function renderVariantImagesList(variantId) {
    const found = findVariantById(variantId);
    const listEl = document.getElementById('variant-images-list');
    listEl.innerHTML = '';

    if (!found) return;

    const images = (found.variant.images || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (images.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Esta variante todavía no tiene ninguna imagen.';
      listEl.appendChild(empty);
      return;
    }

    images.forEach((img) => {
      const row = document.createElement('div');
      row.className = 'image-row';
      row.dataset.imageId = img.id;

      const thumb = document.createElement('img');
      thumb.className = 'image-row-thumb';
      thumb.src = img.url;
      thumb.alt = img.alt || '';
      row.appendChild(thumb);

      const info = document.createElement('div');
      info.className = 'image-row-info';
      const fileName = (img.url || '').split('/').pop() || img.url;
      info.appendChild(el2('p', 'image-row-filename', fileName));
      info.appendChild(el2('p', 'image-row-alt', img.alt ? `ALT: ${img.alt}` : 'ALT: (vacío)'));
      info.appendChild(el2('p', 'image-row-meta', `Orden: ${img.order}`));
      row.appendChild(info);

      const statusWrap = document.createElement('div');
      statusWrap.className = 'image-row-status';

      const activeLabel = document.createElement('label');
      activeLabel.className = 'checkbox-label';
      const activeCheckbox = document.createElement('input');
      activeCheckbox.type = 'checkbox';
      activeCheckbox.className = 'active-toggle image-active-toggle';
      activeCheckbox.checked = !!img.active;
      activeCheckbox.setAttribute('aria-label', `Activa: ${fileName}`);
      activeLabel.appendChild(activeCheckbox);
      activeLabel.appendChild(document.createTextNode(' Activa'));
      statusWrap.appendChild(activeLabel);

      if (img.is_primary) {
        const badge = document.createElement('span');
        badge.className = 'status-badge status-active primary-badge';
        badge.textContent = '★ Principal';
        statusWrap.appendChild(badge);
      } else {
        const primaryBtn = document.createElement('button');
        primaryBtn.type = 'button';
        primaryBtn.className = 'set-primary-btn btn-secondary small';
        primaryBtn.textContent = 'Marcar como principal';
        statusWrap.appendChild(primaryBtn);
      }
      row.appendChild(statusWrap);

      const actions = document.createElement('div');
      actions.className = 'image-row-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'edit-image-btn btn-secondary small';
      editBtn.textContent = 'Editar';
      actions.appendChild(editBtn);
      row.appendChild(actions);

      listEl.appendChild(row);
    });
  }

  // Pequeño helper local (no confundir con el "el" de render.js — este vive
  // solo dentro de admin.js) para no repetir el patrón de crear <p class=...>.
  function el2(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function refreshVariantImagesModalIfOpen() {
    if (variantImagesOverlay.hidden || !currentImagesVariantId) return;
    renderVariantImagesList(currentImagesVariantId);
  }

  /* ---------- Abrir/cerrar el modal de imágenes de una variante ---------- */
  function openVariantImagesModal(variantId) {
    const found = findVariantById(variantId);
    if (!found) return;

    currentImagesVariantId = variantId;
    variantImagesTitle.textContent = `Imágenes de la variante: ${found.variant.name}`;
    variantImagesSubtitle.textContent = `Producto: ${found.product.name}`;
    variantImagesMessage.hidden = true;
    closeVariantImageForm();
    renderVariantImagesList(variantId);
    variantImagesOverlay.hidden = false;
  }

  function closeVariantImagesModal() {
    variantImagesOverlay.hidden = true;
    currentImagesVariantId = null;
    closeVariantImageForm();
  }

  /* ---------- Abrir/cerrar el mini-formulario de agregar/editar imagen ---------- */
  function openVariantImageForm(mode, image) {
    variantImageFormMessage.hidden = true;
    variantImageFormProgress.hidden = true;
    variantImageForm.reset();
    editingImageId = mode === 'edit' ? image.id : null;

    if (mode === 'edit') {
      const fileName = (image.url || '').split('/').pop() || image.url;
      variantImageFormTitle.textContent = `Editar imagen: ${fileName}`;
      variantImageFileRow.hidden = true;
      variantImageFileInput.required = false;
      document.getElementById('vif-alt').value = image.alt || '';
      document.getElementById('vif-order').value = image.order;
      document.getElementById('vif-active').checked = !!image.active;
      document.getElementById('vif-primary').checked = !!image.is_primary;
    } else {
      variantImageFormTitle.textContent = 'Agregar imagen';
      variantImageFileRow.hidden = false;
      variantImageFileInput.required = true;
      document.getElementById('vif-order').value = 0;
      document.getElementById('vif-active').checked = true;
      document.getElementById('vif-primary').checked = false;
    }

    variantImageFormWrap.hidden = false;
  }

  function closeVariantImageForm() {
    variantImageFormWrap.hidden = true;
    editingImageId = null;
    variantImageForm.reset();
    variantImageFileRow.hidden = false;
    variantImageFileInput.required = false;
  }

  /* ---------- Guardar (agregar / editar metadatos) ---------- */
  async function handleVariantImageFormSubmit(e) {
    e.preventDefault();
    variantImageFormMessage.hidden = true;
    variantImageFormProgress.hidden = true;

    const variantId = currentImagesVariantId;
    if (!variantId) {
      variantImageFormMessage.textContent = 'No se pudo determinar la variante. Cierra y vuelve a abrir el modal de imágenes.';
      variantImageFormMessage.hidden = false;
      return;
    }

    // Corrección: images.alt es NOT NULL en el esquema (sin default) — nunca
    // se debe enviar null ni undefined. Si el administrador deja el campo
    // vacío se guarda '' (cadena vacía), tanto al crear como al editar.
    const altRaw = document.getElementById('vif-alt').value.trim();
    const alt = altRaw || '';
    const order = parseInt(document.getElementById('vif-order').value, 10);
    const active = document.getElementById('vif-active').checked;
    const wantsPrimary = document.getElementById('vif-primary').checked;

    if (Number.isNaN(order) || order < 0) {
      variantImageFormMessage.textContent = 'El orden debe ser un número mayor o igual a 0.';
      variantImageFormMessage.hidden = false;
      return;
    }

    const submitBtn = document.getElementById('variant-image-form-submit');
    submitBtn.disabled = true;

    try {
      /* ---- Modo edición: solo metadatos, nunca se vuelve a subir el archivo ---- */
      if (editingImageId) {
        const previousImage = findImageById(variantId, editingImageId);
        const wasPrimary = !!(previousImage && previousImage.is_primary);

        const { data, error } = await client
          .from('images')
          .update({ alt, order, active })
          .eq('id', editingImageId)
          .select();

        if (error) {
          variantImageFormMessage.textContent = describeSupabaseError(error);
          variantImageFormMessage.hidden = false;
          return;
        }
        if (!data || data.length === 0) {
          variantImageFormMessage.textContent = 'Supabase no aplicó ningún cambio (0 filas afectadas). Es probable que la política de seguridad (RLS) haya rechazado la operación.';
          variantImageFormMessage.hidden = false;
          return;
        }

        if (wantsPrimary && !wasPrimary) {
          const result = await setPrimaryImage(variantId, editingImageId);
          if (!result.ok) {
            variantImageFormMessage.textContent = result.error
              ? describeSupabaseError(result.error)
              : 'Los metadatos se guardaron, pero no se pudo marcar la imagen como principal (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.';
            variantImageFormMessage.hidden = false;
            await loadPanelData();
            refreshVariantImagesModalIfOpen();
            return;
          }
        } else if (!wantsPrimary && wasPrimary) {
          const { error: offError } = await client.from('images').update({ is_primary: false }).eq('id', editingImageId).select();
          if (offError) {
            variantImageFormMessage.textContent = describeSupabaseError(offError);
            variantImageFormMessage.hidden = false;
            await loadPanelData();
            refreshVariantImagesModalIfOpen();
            return;
          }
        }

        showPanelMessage('Imagen actualizada correctamente.', false);
        closeVariantImageForm();
        await loadPanelData();
        refreshVariantImagesModalIfOpen();
        return;
      }

      /* ---- Modo creación: requiere subir el archivo primero ---- */
      const file = variantImageFileInput.files && variantImageFileInput.files[0];
      const fileError = validateImageFile(file);
      if (fileError) {
        variantImageFormMessage.textContent = fileError;
        variantImageFormMessage.hidden = false;
        return;
      }

      variantImageFormProgress.hidden = false;
      const path = buildVariantImageStoragePath(variantId, file);

      const { error: uploadError } = await client.storage
        .from(CATALOG_IMAGES_BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });

      if (uploadError) {
        variantImageFormProgress.hidden = true;
        variantImageFormMessage.textContent = describeStorageError(uploadError);
        variantImageFormMessage.hidden = false;
        return;
      }

      const { data: publicUrlData } = client.storage.from(CATALOG_IMAGES_BUCKET).getPublicUrl(path);
      const publicUrl = publicUrlData && publicUrlData.publicUrl;

      if (!publicUrl) {
        variantImageFormProgress.hidden = true;
        variantImageFormMessage.textContent = `La imagen se subió a Storage en la ruta "${path}" pero no se pudo construir su URL pública. Revisa la configuración del bucket "${CATALOG_IMAGES_BUCKET}".`;
        variantImageFormMessage.hidden = false;
        return;
      }

      // Nunca se inserta con is_primary: true directamente — ver
      // setPrimaryImage() más arriba.
      const { data: insertedRows, error: insertError } = await client
        .from('images')
        .insert({
          variant_id: variantId,
          product_id: null,
          url: publicUrl,
          alt,
          order,
          active,
          is_primary: false,
        })
        .select();

      variantImageFormProgress.hidden = true;

      if (insertError) {
        // Archivo huérfano: ya se subió a Storage pero no quedó registrado
        // en images. No hay política de DELETE sobre el bucket (a propósito
        // — no se agregó ninguna), así que no se intenta borrarlo: se avisa
        // con la ruta exacta para identificarlo manualmente si hace falta.
        variantImageFormMessage.textContent = `La imagen se subió correctamente a Storage (ruta: "${path}") pero no se pudo guardar el registro en la tabla images: ${describeSupabaseError(insertError)}. El archivo queda huérfano en Storage — no aparece en ningún lado porque ninguna fila lo referencia. Si quieres eliminarlo, hazlo manualmente desde el panel de Supabase.`;
        variantImageFormMessage.hidden = false;
        return;
      }
      if (!insertedRows || insertedRows.length === 0) {
        variantImageFormMessage.textContent = `La imagen se subió correctamente a Storage (ruta: "${path}") pero Supabase no devolvió el registro creado — probablemente la política de seguridad (RLS) rechazó el INSERT. El archivo queda huérfano en Storage (no visible en ningún lado) hasta que se revise manualmente.`;
        variantImageFormMessage.hidden = false;
        return;
      }

      const newImageId = insertedRows[0].id;

      if (wantsPrimary) {
        const result = await setPrimaryImage(variantId, newImageId);
        if (!result.ok) {
          showPanelMessage(
            `La imagen se creó correctamente, pero no se pudo marcar como principal (${result.error ? describeSupabaseError(result.error) : 'Supabase no aplicó el cambio — 0 filas afectadas, probablemente RLS'}). Puedes intentarlo de nuevo con el botón "Marcar como principal".`,
            true
          );
          closeVariantImageForm();
          await loadPanelData();
          refreshVariantImagesModalIfOpen();
          return;
        }
      }

      showPanelMessage('Imagen agregada correctamente.', false);
      closeVariantImageForm();
      await loadPanelData();
      refreshVariantImagesModalIfOpen();
    } finally {
      submitBtn.disabled = false;
    }
  }

  /* ---------- Activar/desactivar y marcar-como-principal rápidos desde la lista ---------- */
  async function handleToggleImageActive(imageId, newActive, checkboxEl) {
    checkboxEl.disabled = true;

    const { data, error } = await client
      .from('images')
      .update({ active: newActive })
      .eq('id', imageId)
      .select();

    if (error) {
      checkboxEl.checked = !newActive;
      variantImagesMessage.textContent = describeSupabaseError(error);
      variantImagesMessage.hidden = false;
      checkboxEl.disabled = false;
      return;
    }
    if (!data || data.length === 0) {
      checkboxEl.checked = !newActive;
      variantImagesMessage.textContent = 'Supabase no aplicó el cambio (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.';
      variantImagesMessage.hidden = false;
      checkboxEl.disabled = false;
      return;
    }

    variantImagesMessage.hidden = true;
    checkboxEl.disabled = false;
    await loadPanelData();
    refreshVariantImagesModalIfOpen();
  }

  async function handleSetPrimaryClick(imageId, variantId) {
    const result = await setPrimaryImage(variantId, imageId);
    if (!result.ok) {
      variantImagesMessage.textContent = result.error
        ? describeSupabaseError(result.error)
        : 'Supabase no aplicó el cambio de imagen principal (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.';
      variantImagesMessage.hidden = false;
      return;
    }
    variantImagesMessage.hidden = true;
    await loadPanelData();
    refreshVariantImagesModalIfOpen();
  }

  /* ============================================================
   * ETAPA 4D (parte A) — Imágenes propias del producto (tabla images,
   * product_id set, variant_id null)
   *
   * Es exactamente el mismo mecanismo que ya usan las imágenes de variante
   * (mismo bucket "catalog-images", misma validación de tipo/tamaño en el
   * navegador, mismo orden de dos escrituras para "marcar como principal",
   * mismo comportamiento ante un archivo huérfano en Storage) — no se creó
   * ninguna función genérica que sirva a ambos casos a la vez: se prefirió
   * duplicar el patrón (igual que ya se hizo en la Etapa 4C con "includes")
   * en vez de arriesgar el código de variantes, que ya funciona, con un
   * refactor. Las funciones ya genéricas (describeStorageError,
   * validateImageFile, slugify, ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES,
   * CATALOG_IMAGES_BUCKET) se reutilizan tal cual, sin tocarlas.
   * ============================================================ */

  // Ruta única dentro del bucket: products/{productId}/{timestamp}-{slug}.ext
  function buildProductImageStoragePath(productId, file) {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0
      ? file.name.slice(dot + 1).toLowerCase()
      : (file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg');
    const baseName = dot >= 0 ? file.name.slice(0, dot) : file.name;
    const slug = slugify(baseName) || 'imagen';
    return `products/${productId}/${Date.now()}-${slug}.${ext}`;
  }

  function findProductImageById(productId, imageId) {
    const product = currentProducts.find((p) => p.id === productId);
    if (!product) return null;
    return (product.images || []).find((img) => img.id === imageId) || null;
  }

  /* ---------- Marcar como principal (imagen de producto) ----------
   * Mismo orden de dos escrituras que setPrimaryImage() (variantes): primero
   * apaga cualquier otra imagen principal del MISMO producto, después
   * enciende la elegida — respeta el índice único parcial
   * uq_images_one_primary_per_product ya existente, sin crear ninguna
   * restricción nueva.
   */
  async function setPrimaryProductImage(productId, imageId) {
    const { error: unsetError } = await client
      .from('images')
      .update({ is_primary: false })
      .eq('product_id', productId)
      .eq('is_primary', true)
      .neq('id', imageId)
      .select();

    if (unsetError) {
      return { ok: false, error: unsetError };
    }

    const { data, error: setError } = await client
      .from('images')
      .update({ is_primary: true })
      .eq('id', imageId)
      .select();

    if (setError) {
      return { ok: false, error: setError };
    }
    if (!data || data.length === 0) {
      return { ok: false, error: null };
    }
    return { ok: true, data };
  }

  /* ---------- Lista de imágenes dentro del modal de producto ---------- */
  function renderProductImagesList(productId) {
    const product = currentProducts.find((p) => p.id === productId);
    const listEl = document.getElementById('product-images-list');
    listEl.innerHTML = '';

    if (!product) return;

    const images = (product.images || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (images.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Este producto todavía no tiene ninguna imagen propia.';
      listEl.appendChild(empty);
      return;
    }

    images.forEach((img) => {
      const row = document.createElement('div');
      row.className = 'image-row';
      row.dataset.imageId = img.id;

      const thumb = document.createElement('img');
      thumb.className = 'image-row-thumb';
      thumb.src = img.url;
      thumb.alt = img.alt || '';
      row.appendChild(thumb);

      const info = document.createElement('div');
      info.className = 'image-row-info';
      const fileName = (img.url || '').split('/').pop() || img.url;
      info.appendChild(el2('p', 'image-row-filename', fileName));
      info.appendChild(el2('p', 'image-row-alt', img.alt ? `ALT: ${img.alt}` : 'ALT: (vacío)'));
      info.appendChild(el2('p', 'image-row-meta', `Orden: ${img.order}`));
      row.appendChild(info);

      const statusWrap = document.createElement('div');
      statusWrap.className = 'image-row-status';

      const activeLabel = document.createElement('label');
      activeLabel.className = 'checkbox-label';
      const activeCheckbox = document.createElement('input');
      activeCheckbox.type = 'checkbox';
      activeCheckbox.className = 'active-toggle product-image-active-toggle';
      activeCheckbox.checked = !!img.active;
      activeCheckbox.setAttribute('aria-label', `Activa: ${fileName}`);
      activeLabel.appendChild(activeCheckbox);
      activeLabel.appendChild(document.createTextNode(' Activa'));
      statusWrap.appendChild(activeLabel);

      if (img.is_primary) {
        const badge = document.createElement('span');
        badge.className = 'status-badge status-active primary-badge';
        badge.textContent = '★ Principal';
        statusWrap.appendChild(badge);
      } else {
        const primaryBtn = document.createElement('button');
        primaryBtn.type = 'button';
        primaryBtn.className = 'set-primary-product-image-btn btn-secondary small';
        primaryBtn.textContent = 'Marcar como principal';
        statusWrap.appendChild(primaryBtn);
      }
      row.appendChild(statusWrap);

      const actions = document.createElement('div');
      actions.className = 'image-row-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'edit-product-image-btn btn-secondary small';
      editBtn.textContent = 'Editar';
      actions.appendChild(editBtn);
      row.appendChild(actions);

      listEl.appendChild(row);
    });
  }

  function refreshProductImagesModalIfOpen() {
    if (productImagesOverlay.hidden || !currentImagesProductId) return;
    renderProductImagesList(currentImagesProductId);
  }

  /* ---------- Abrir/cerrar el modal de imágenes de un producto ---------- */
  function openProductImagesModal(productId) {
    const product = currentProducts.find((p) => p.id === productId);
    if (!product) return;

    currentImagesProductId = productId;
    productImagesTitle.textContent = `Imágenes del producto: ${product.name}`;
    productImagesSubtitle.textContent = (product.product_variants || []).length
      ? `${(product.product_variants || []).length} variante(s) — estas imágenes son propias del producto, independientes de las de cada variante.`
      : 'Este producto no tiene variantes.';
    productImagesMessage.hidden = true;
    closeProductImageForm();
    renderProductImagesList(productId);
    productImagesOverlay.hidden = false;
  }

  function closeProductImagesModal() {
    productImagesOverlay.hidden = true;
    currentImagesProductId = null;
    closeProductImageForm();
  }

  /* ---------- Abrir/cerrar el mini-formulario de agregar/editar imagen de producto ---------- */
  function openProductImageForm(mode, image) {
    productImageFormMessage.hidden = true;
    productImageFormProgress.hidden = true;
    productImageForm.reset();
    editingProductImageId = mode === 'edit' ? image.id : null;

    if (mode === 'edit') {
      const fileName = (image.url || '').split('/').pop() || image.url;
      productImageFormTitle.textContent = `Editar imagen: ${fileName}`;
      productImageFileRow.hidden = true;
      productImageFileInput.required = false;
      document.getElementById('pif-alt').value = image.alt || '';
      document.getElementById('pif-order').value = image.order;
      document.getElementById('pif-active').checked = !!image.active;
      document.getElementById('pif-primary').checked = !!image.is_primary;
    } else {
      productImageFormTitle.textContent = 'Agregar imagen';
      productImageFileRow.hidden = false;
      productImageFileInput.required = true;
      document.getElementById('pif-order').value = 0;
      document.getElementById('pif-active').checked = true;
      document.getElementById('pif-primary').checked = false;
    }

    productImageFormWrap.hidden = false;
  }

  function closeProductImageForm() {
    productImageFormWrap.hidden = true;
    editingProductImageId = null;
    productImageForm.reset();
    productImageFileRow.hidden = false;
    productImageFileInput.required = false;
  }

  /* ---------- Guardar (agregar / editar metadatos) — imagen de producto ---------- */
  async function handleProductImageFormSubmit(e) {
    e.preventDefault();
    productImageFormMessage.hidden = true;
    productImageFormProgress.hidden = true;

    const productId = currentImagesProductId;
    if (!productId) {
      productImageFormMessage.textContent = 'No se pudo determinar el producto. Cierra y vuelve a abrir el modal de imágenes.';
      productImageFormMessage.hidden = false;
      return;
    }

    // images.alt es NOT NULL en el esquema (sin default) — nunca se debe
    // enviar null ni undefined. Si el administrador deja el campo vacío se
    // guarda '' (cadena vacía), tanto al crear como al editar.
    const altRaw = document.getElementById('pif-alt').value.trim();
    const alt = altRaw || '';
    const order = parseInt(document.getElementById('pif-order').value, 10);
    const active = document.getElementById('pif-active').checked;
    const wantsPrimary = document.getElementById('pif-primary').checked;

    if (Number.isNaN(order) || order < 0) {
      productImageFormMessage.textContent = 'El orden debe ser un número mayor o igual a 0.';
      productImageFormMessage.hidden = false;
      return;
    }

    const submitBtn = document.getElementById('product-image-form-submit');
    submitBtn.disabled = true;

    try {
      /* ---- Modo edición: solo metadatos, nunca se vuelve a subir el archivo ---- */
      if (editingProductImageId) {
        const previousImage = findProductImageById(productId, editingProductImageId);
        const wasPrimary = !!(previousImage && previousImage.is_primary);

        const { data, error } = await client
          .from('images')
          .update({ alt, order, active })
          .eq('id', editingProductImageId)
          .select();

        if (error) {
          productImageFormMessage.textContent = describeSupabaseError(error);
          productImageFormMessage.hidden = false;
          return;
        }
        if (!data || data.length === 0) {
          productImageFormMessage.textContent = 'Supabase no aplicó ningún cambio (0 filas afectadas). Es probable que la política de seguridad (RLS) haya rechazado la operación.';
          productImageFormMessage.hidden = false;
          return;
        }

        if (wantsPrimary && !wasPrimary) {
          const result = await setPrimaryProductImage(productId, editingProductImageId);
          if (!result.ok) {
            productImageFormMessage.textContent = result.error
              ? describeSupabaseError(result.error)
              : 'Los metadatos se guardaron, pero no se pudo marcar la imagen como principal (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.';
            productImageFormMessage.hidden = false;
            await loadPanelData();
            refreshProductImagesModalIfOpen();
            return;
          }
        } else if (!wantsPrimary && wasPrimary) {
          const { error: offError } = await client.from('images').update({ is_primary: false }).eq('id', editingProductImageId).select();
          if (offError) {
            productImageFormMessage.textContent = describeSupabaseError(offError);
            productImageFormMessage.hidden = false;
            await loadPanelData();
            refreshProductImagesModalIfOpen();
            return;
          }
        }

        showPanelMessage('Imagen actualizada correctamente.', false);
        closeProductImageForm();
        await loadPanelData();
        refreshProductImagesModalIfOpen();
        return;
      }

      /* ---- Modo creación: requiere subir el archivo primero ---- */
      const file = productImageFileInput.files && productImageFileInput.files[0];
      const fileError = validateImageFile(file);
      if (fileError) {
        productImageFormMessage.textContent = fileError;
        productImageFormMessage.hidden = false;
        return;
      }

      productImageFormProgress.hidden = false;
      const path = buildProductImageStoragePath(productId, file);

      const { error: uploadError } = await client.storage
        .from(CATALOG_IMAGES_BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });

      if (uploadError) {
        productImageFormProgress.hidden = true;
        productImageFormMessage.textContent = describeStorageError(uploadError);
        productImageFormMessage.hidden = false;
        return;
      }

      const { data: publicUrlData } = client.storage.from(CATALOG_IMAGES_BUCKET).getPublicUrl(path);
      const publicUrl = publicUrlData && publicUrlData.publicUrl;

      if (!publicUrl) {
        productImageFormProgress.hidden = true;
        productImageFormMessage.textContent = `La imagen se subió a Storage en la ruta "${path}" pero no se pudo construir su URL pública. Revisa la configuración del bucket "${CATALOG_IMAGES_BUCKET}".`;
        productImageFormMessage.hidden = false;
        return;
      }

      // Nunca se inserta con is_primary: true directamente — ver
      // setPrimaryProductImage() más arriba. product_id = producto actual,
      // variant_id siempre null (así distingue la base de datos una imagen
      // de producto de una de variante — chk_images_single_owner ya exige
      // que exactamente uno de los dos esté presente).
      const { data: insertedRows, error: insertError } = await client
        .from('images')
        .insert({
          product_id: productId,
          variant_id: null,
          url: publicUrl,
          alt,
          order,
          active,
          is_primary: false,
        })
        .select();

      productImageFormProgress.hidden = true;

      if (insertError) {
        // Archivo huérfano: ya se subió a Storage pero no quedó registrado
        // en images. No hay política de DELETE sobre el bucket (a propósito
        // — no se agregó ninguna), así que no se intenta borrarlo: se avisa
        // con la ruta exacta para identificarlo manualmente si hace falta.
        productImageFormMessage.textContent = `La imagen se subió correctamente a Storage (ruta: "${path}") pero no se pudo guardar el registro en la tabla images: ${describeSupabaseError(insertError)}. El archivo queda huérfano en Storage — no aparece en ningún lado porque ninguna fila lo referencia. Si quieres eliminarlo, hazlo manualmente desde el panel de Supabase.`;
        productImageFormMessage.hidden = false;
        return;
      }
      if (!insertedRows || insertedRows.length === 0) {
        productImageFormMessage.textContent = `La imagen se subió correctamente a Storage (ruta: "${path}") pero Supabase no devolvió el registro creado — probablemente la política de seguridad (RLS) rechazó el INSERT. El archivo queda huérfano en Storage (no visible en ningún lado) hasta que se revise manualmente.`;
        productImageFormMessage.hidden = false;
        return;
      }

      const newImageId = insertedRows[0].id;

      if (wantsPrimary) {
        const result = await setPrimaryProductImage(productId, newImageId);
        if (!result.ok) {
          showPanelMessage(
            `La imagen se creó correctamente, pero no se pudo marcar como principal (${result.error ? describeSupabaseError(result.error) : 'Supabase no aplicó el cambio — 0 filas afectadas, probablemente RLS'}). Puedes intentarlo de nuevo con el botón "Marcar como principal".`,
            true
          );
          closeProductImageForm();
          await loadPanelData();
          refreshProductImagesModalIfOpen();
          return;
        }
      }

      showPanelMessage('Imagen agregada correctamente.', false);
      closeProductImageForm();
      await loadPanelData();
      refreshProductImagesModalIfOpen();
    } finally {
      submitBtn.disabled = false;
    }
  }

  /* ---------- Activar/desactivar y marcar-como-principal rápidos desde la lista (imagen de producto) ---------- */
  async function handleToggleProductImageActive(imageId, newActive, checkboxEl) {
    checkboxEl.disabled = true;

    const { data, error } = await client
      .from('images')
      .update({ active: newActive })
      .eq('id', imageId)
      .select();

    if (error) {
      checkboxEl.checked = !newActive;
      productImagesMessage.textContent = describeSupabaseError(error);
      productImagesMessage.hidden = false;
      checkboxEl.disabled = false;
      return;
    }
    if (!data || data.length === 0) {
      checkboxEl.checked = !newActive;
      productImagesMessage.textContent = 'Supabase no aplicó el cambio (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.';
      productImagesMessage.hidden = false;
      checkboxEl.disabled = false;
      return;
    }

    productImagesMessage.hidden = true;
    await loadPanelData();
    refreshProductImagesModalIfOpen();
    checkboxEl.disabled = false;
  }

  async function handleSetPrimaryProductImageClick(imageId, productId) {
    const result = await setPrimaryProductImage(productId, imageId);
    if (!result.ok) {
      productImagesMessage.textContent = result.error
        ? describeSupabaseError(result.error)
        : 'Supabase no aplicó el cambio de imagen principal (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.';
      productImagesMessage.hidden = false;
      return;
    }
    productImagesMessage.hidden = true;
    await loadPanelData();
    refreshProductImagesModalIfOpen();
  }

  /* ============================================================
   * ETAPA 4D (parte B) — Eliminar producto
   *
   * Confirmación sencilla (un solo paso, sin pedir escribir el nombre) y
   * luego un único DELETE filtrado por id. NO se borran variantes ni
   * imágenes a mano desde aquí: supabase/schema.sql ya tiene
   * "on delete cascade" en product_variants.product_id, images.product_id
   * e images.variant_id (confirmado por inspección directa del esquema
   * antes de implementar esta etapa) — Postgres se encarga de esas filas
   * solo, sin que este archivo tenga que reimplementarlo. Los ARCHIVOS
   * físicos en Storage NO se borran (no existe política de DELETE sobre el
   * bucket "catalog-images", ni se agrega ninguna aquí): si el producto
   * tenía imágenes, sus archivos quedan huérfanos en Storage después de
   * eliminarlo — ver el informe de esta etapa.
   * ============================================================ */
  function openDeleteProductConfirm(productId) {
    productIdPendingDelete = productId;
    deleteProductMessage.hidden = true;
    deleteProductOverlay.hidden = false;
  }

  function closeDeleteProductConfirm() {
    deleteProductOverlay.hidden = true;
    productIdPendingDelete = null;
    deleteProductMessage.hidden = true;
  }

  async function handleConfirmDeleteProduct() {
    if (!productIdPendingDelete) return;
    const productId = productIdPendingDelete;
    const product = currentProducts.find((p) => p.id === productId);
    const productName = product ? product.name : productId;

    deleteProductConfirmBtn.disabled = true;
    try {
      const { data, error } = await client
        .from('products')
        .delete()
        .eq('id', productId)
        .select();

      if (error) {
        deleteProductMessage.textContent = describeSupabaseError(error);
        deleteProductMessage.hidden = false;
        return;
      }
      if (!data || data.length === 0) {
        deleteProductMessage.textContent = 'Supabase no eliminó ninguna fila (0 filas afectadas). Es probable que la política de seguridad (RLS) haya rechazado la operación. El producto NO fue eliminado.';
        deleteProductMessage.hidden = false;
        return;
      }

      closeDeleteProductConfirm();
      showPanelMessage(`Producto "${productName}" eliminado correctamente.`, false);
      await loadPanelData();
    } finally {
      deleteProductConfirmBtn.disabled = false;
    }
  }

  /* ============================================================
   * ETAPA 4E (parte A) — Eliminar variante
   *
   * Mismo patrón exacto que "Eliminar producto" (Etapa 4D): confirmación de
   * un solo paso y un único DELETE filtrado por id. NO se borra nada más a
   * mano: supabase/schema.sql ya tiene "images.variant_id references
   * product_variants(id) on delete cascade" (confirmado por inspección
   * directa del esquema antes de implementar esta etapa) — Postgres borra
   * solo las imágenes propias de la variante. Los ARCHIVOS físicos en
   * Storage NO se borran (no existe política de DELETE sobre el bucket, ni
   * se agrega ninguna aquí): si la variante tenía imágenes, sus archivos
   * quedan huérfanos en Storage después de eliminarla.
   * ============================================================ */
  function openDeleteVariantConfirm(variantId) {
    variantIdPendingDelete = variantId;
    deleteVariantMessage.hidden = true;
    deleteVariantOverlay.hidden = false;
  }

  function closeDeleteVariantConfirm() {
    deleteVariantOverlay.hidden = true;
    variantIdPendingDelete = null;
    deleteVariantMessage.hidden = true;
  }

  async function handleConfirmDeleteVariant() {
    if (!variantIdPendingDelete) return;
    const variantId = variantIdPendingDelete;
    const found = findVariantById(variantId);
    const variantName = found ? found.variant.name : variantId;

    deleteVariantConfirmBtn.disabled = true;
    try {
      const { data, error } = await client
        .from('product_variants')
        .delete()
        .eq('id', variantId)
        .select();

      if (error) {
        deleteVariantMessage.textContent = describeSupabaseError(error);
        deleteVariantMessage.hidden = false;
        return;
      }
      if (!data || data.length === 0) {
        deleteVariantMessage.textContent = 'Supabase no eliminó ninguna fila (0 filas afectadas). Es probable que la política de seguridad (RLS) haya rechazado la operación. La variante NO fue eliminada.';
        deleteVariantMessage.hidden = false;
        return;
      }

      closeDeleteVariantConfirm();
      showPanelMessage(`Variante "${variantName}" eliminada correctamente.`, false);
      await loadPanelData();
    } finally {
      deleteVariantConfirmBtn.disabled = false;
    }
  }

  /* ============================================================
   * ETAPA 4E (parte B) — Eliminar categoría
   *
   * A diferencia de productos y variantes, categories NO tiene
   * "on delete cascade" hacia products — el esquema real usa
   * "products.category_id references categories(id) on delete restrict"
   * (confirmado por inspección directa antes de implementar esta etapa), a
   * propósito: nunca se quiere borrar productos "de rebote" al borrar una
   * categoría. Por eso aquí hay una comprobación extra, puramente informativa
   * y del lado del cliente, ANTES de intentar el DELETE: si la categoría
   * todavía tiene productos (contados sobre currentProducts, ya cargado por
   * loadPanelData), se avisa de inmediato sin llamar a Supabase. Esto es
   * solo una ayuda para el administrador — la autoridad real sigue siendo la
   * restricción de la base de datos: si de todas formas el DELETE llega a
   * Supabase (por ejemplo porque otra sesión de administrador creó un
   * producto nuevo en esa categoría un instante antes), Postgres lo rechaza
   * igual con una violación de llave foránea (código 23503), y
   * describeSupabaseError() ya sabe traducir ese error al mismo mensaje
   * amigable — nunca se oculta ni se reinterpreta como otra cosa. No se
   * modifica el FK ni se agrega CASCADE.
   * ============================================================ */
  const CATEGORY_HAS_PRODUCTS_MESSAGE = 'No se puede eliminar esta categoría porque tiene productos asociados. Primero elimina o mueve esos productos a otra categoría.';

  function openDeleteCategoryConfirm(categoryId) {
    categoryIdPendingDelete = categoryId;
    deleteCategoryMessage.hidden = true;
    deleteCategoryOverlay.hidden = false;
  }

  function closeDeleteCategoryConfirm() {
    deleteCategoryOverlay.hidden = true;
    categoryIdPendingDelete = null;
    deleteCategoryMessage.hidden = true;
  }

  async function handleConfirmDeleteCategory() {
    if (!categoryIdPendingDelete) return;
    const categoryId = categoryIdPendingDelete;
    const category = findCategoryById(categoryId);
    const categoryName = category ? category.nav_label : categoryId;

    // Comprobación previa en el cliente (ver comentario del bloque) — evita
    // una llamada innecesaria a Supabase cuando ya se sabe que se va a
    // rechazar, sin reemplazar la restricción real de la base de datos.
    const productCount = currentProducts.filter((p) => p.category_id === categoryId).length;
    if (productCount > 0) {
      deleteCategoryMessage.textContent = CATEGORY_HAS_PRODUCTS_MESSAGE;
      deleteCategoryMessage.hidden = false;
      return;
    }

    deleteCategoryConfirmBtn.disabled = true;
    try {
      const { data, error } = await client
        .from('categories')
        .delete()
        .eq('id', categoryId)
        .select();

      if (error) {
        deleteCategoryMessage.textContent = describeSupabaseError(error);
        deleteCategoryMessage.hidden = false;
        return;
      }
      if (!data || data.length === 0) {
        deleteCategoryMessage.textContent = 'Supabase no eliminó ninguna fila (0 filas afectadas). Es probable que la política de seguridad (RLS) haya rechazado la operación. La categoría NO fue eliminada.';
        deleteCategoryMessage.hidden = false;
        return;
      }

      closeDeleteCategoryConfirm();
      showPanelMessage(`Categoría "${categoryName}" eliminada correctamente.`, false);
      await loadPanelData();
    } finally {
      deleteCategoryConfirmBtn.disabled = false;
    }
  }

  /* ============================================================
   * ETAPA 4 — Gestión de categorías (categories)
   * ETAPA 4B añade la creación de categorías nuevas sobre la misma base:
   * openCategoryForm(mode, category) ahora tiene un modo 'create' además del
   * 'edit' original. En modo 'edit', id/slug/anchor_id se siguen mostrando
   * como texto de solo lectura (<p>, no <input>) exactamente igual que
   * antes — nunca se vuelven editables, y el payload de UPDATE sigue sin
   * incluirlos nunca. En modo 'create' aparecen tres <input> (#cf-id,
   * #cf-slug, #cf-anchor-id) que solo existen para ese modo — son las
   * únicas columnas de categories que se piden manualmente porque no hay
   * forma de generarlas automáticamente sin inventar una convención que el
   * proyecto no tiene hoy. Los demás campos (nav_label, footer_label,
   * eyebrow, heading, description, type_heading, note, layout,
   * section_modifier, order, active) son idénticos en ambos modos.
   * updated_at nunca se envía en ningún caso: lo gestiona el trigger
   * trg_categories_updated_at ya existente en supabase/schema.sql (y en un
   * INSERT, created_at/updated_at los pone el propio default de la
   * columna). layout y section_modifier solo permiten, tanto en el <select>
   * como en la validación de respaldo, los valores que ya acepta el CHECK
   * constraint real (ver ALLOWED_CATEGORY_LAYOUTS/ALLOWED_CATEGORY_SECTION_MODIFIERS
   * arriba) — no se inventa ningún valor nuevo. Toda la autorización la
   * decide la política RLS admin_all_categories del lado de Supabase
   * (using/with check is_admin()), exactamente igual que products y
   * product_variants — este archivo solo interpreta y muestra con claridad
   * lo que Supabase responde.
   * ============================================================ */

  /* ---------- Abrir/cerrar el formulario de categoría ---------- */
  function openCategoryForm(mode, category) {
    categoryFormMessage.hidden = true;
    categoryForm.reset();
    editingCategoryId = mode === 'edit' ? category.id : null;

    if (mode === 'edit') {
      categoryFormTitle.textContent = `Editar categoría: ${category.nav_label}`;
      categoryPreviewRow.hidden = false;
      categoryAnchorPreviewRow.hidden = false;
      categoryIdInputRow.hidden = true;
      categoryAnchorInputRow.hidden = true;

      categoryIdPreview.textContent = category.id;
      categorySlugPreview.textContent = category.slug;
      categoryAnchorPreview.textContent = category.anchor_id;

      document.getElementById('cf-nav-label').value = category.nav_label || '';
      document.getElementById('cf-footer-label').value = category.footer_label || '';
      document.getElementById('cf-eyebrow').value = category.eyebrow || '';
      document.getElementById('cf-heading').value = category.heading || '';
      document.getElementById('cf-description').value = category.description || '';
      document.getElementById('cf-type-heading').value = category.type_heading || '';
      document.getElementById('cf-note').value = category.note || '';
      document.getElementById('cf-layout').value = category.layout || '';
      document.getElementById('cf-section-modifier').value = category.section_modifier || '';
      document.getElementById('cf-order').value = category.order;
      document.getElementById('cf-active').checked = !!category.active;

      categoryFormSubmitBtn.textContent = 'Guardar';
    } else {
      categoryFormTitle.textContent = 'Nueva categoría';
      categoryPreviewRow.hidden = true;
      categoryAnchorPreviewRow.hidden = true;
      categoryIdInputRow.hidden = false;
      categoryAnchorInputRow.hidden = false;

      // Formulario siempre en blanco al abrir "Nueva categoría" — no
      // arrastra nada de una edición o creación anterior.
      categoryIdInput.value = '';
      categorySlugInput.value = '';
      categoryAnchorInput.value = '';
      document.getElementById('cf-nav-label').value = '';
      document.getElementById('cf-footer-label').value = '';
      document.getElementById('cf-eyebrow').value = '';
      document.getElementById('cf-heading').value = '';
      document.getElementById('cf-description').value = '';
      document.getElementById('cf-type-heading').value = '';
      document.getElementById('cf-note').value = '';
      document.getElementById('cf-layout').value = 'simple-grid';
      document.getElementById('cf-section-modifier').value = '';
      document.getElementById('cf-order').value = 0;
      // Mismo comportamiento por defecto que Nuevo producto/Nueva variante:
      // activa=true al crear, salvo que el administrador la desmarque.
      document.getElementById('cf-active').checked = true;

      categoryFormSubmitBtn.textContent = 'Crear categoría';
    }

    categoryFormOverlay.hidden = false;
  }

  function closeCategoryForm() {
    categoryFormOverlay.hidden = true;
    editingCategoryId = null;
    categoryForm.reset();
  }

  /* ---------- Validación de duplicados de id/slug/anchor_id (solo crear) ----------
   * id, slug y anchor_id son las tres columnas UNIQUE (id además es primary
   * key) de categories según supabase/schema.sql — sin ningún otro formato
   * exigido por el esquema (no hay CHECK de formato, solo NOT NULL +
   * UNIQUE). Esta función valida exactamente eso, contra
   * currentCategories (ya cargado por loadPanelData — evita pedirle a
   * Supabase una consulta extra solo para comprobar duplicados). Es una
   * ayuda para no depender de que Supabase devuelva el error de la
   * restricción — la autoridad real sigue siendo la base de datos, y si de
   * todas formas llega un 23505 (por ejemplo por una carrera con otra
   * sesión de administrador), describeSupabaseError ya lo traduce a un
   * mensaje comprensible.
   */
  function validateNewCategoryIdentifiers(id, slug, anchorId) {
    if (!id) return 'El ID es obligatorio.';
    if (!slug) return 'El slug es obligatorio.';
    if (!anchorId) return 'El anchor ID es obligatorio.';
    if (currentCategories.some((c) => c.id === id)) {
      return `Ya existe una categoría con el id "${id}".`;
    }
    if (currentCategories.some((c) => c.slug === slug)) {
      return `Ya existe una categoría con el slug "${slug}".`;
    }
    if (currentCategories.some((c) => c.anchor_id === anchorId)) {
      return `Ya existe una categoría con el anchor_id "${anchorId}".`;
    }
    return null;
  }

  /* ---------- Guardar (crear/editar) ----------
   * En edición, el payload solo incluye las 11 columnas editables de la
   * Etapa 4: id, slug, anchor_id, created_at y updated_at nunca aparecen
   * ahí — no hay forma de que el administrador los cambie desde este
   * formulario. En creación (Etapa 4B), el payload de INSERT añade además
   * id, slug y anchor_id (los tres tal como los escribió el administrador,
   * validados antes contra duplicados) — son las únicas columnas nuevas
   * respecto a la Etapa 4, y solo pueden viajar en el INSERT, nunca en un
   * UPDATE posterior sobre una categoría existente.
   */
  async function handleCategoryFormSubmit(e) {
    e.preventDefault();
    categoryFormMessage.hidden = true;

    const isCreating = !editingCategoryId;

    let newId = null;
    let newSlug = null;
    let newAnchorId = null;
    if (isCreating) {
      newId = categoryIdInput.value.trim();
      newSlug = categorySlugInput.value.trim();
      newAnchorId = categoryAnchorInput.value.trim();

      const identifierError = validateNewCategoryIdentifiers(newId, newSlug, newAnchorId);
      if (identifierError) {
        categoryFormMessage.textContent = identifierError;
        categoryFormMessage.hidden = false;
        return;
      }
    }

    const navLabel = document.getElementById('cf-nav-label').value.trim();
    const footerLabel = document.getElementById('cf-footer-label').value.trim() || null;
    const eyebrow = document.getElementById('cf-eyebrow').value.trim() || null;
    const heading = document.getElementById('cf-heading').value.trim();
    const description = document.getElementById('cf-description').value.trim() || null;
    const typeHeading = document.getElementById('cf-type-heading').value.trim() || null;
    const note = document.getElementById('cf-note').value.trim() || null;
    const layout = document.getElementById('cf-layout').value;
    const sectionModifier = document.getElementById('cf-section-modifier').value || null;
    const order = parseInt(document.getElementById('cf-order').value, 10);
    const active = document.getElementById('cf-active').checked;

    if (!navLabel) {
      categoryFormMessage.textContent = 'El nombre en el menú (nav_label) es obligatorio.';
      categoryFormMessage.hidden = false;
      return;
    }
    if (!heading) {
      categoryFormMessage.textContent = 'El título de la sección (heading) es obligatorio.';
      categoryFormMessage.hidden = false;
      return;
    }
    if (!ALLOWED_CATEGORY_LAYOUTS.includes(layout)) {
      categoryFormMessage.textContent = `Layout no válido. Los valores permitidos son: ${ALLOWED_CATEGORY_LAYOUTS.join(', ')}.`;
      categoryFormMessage.hidden = false;
      return;
    }
    if (sectionModifier !== null && !ALLOWED_CATEGORY_SECTION_MODIFIERS.includes(sectionModifier)) {
      categoryFormMessage.textContent = `Modificador de sección no válido. Los valores permitidos son: (ninguno), ${ALLOWED_CATEGORY_SECTION_MODIFIERS.join(', ')}.`;
      categoryFormMessage.hidden = false;
      return;
    }
    if (Number.isNaN(order)) {
      categoryFormMessage.textContent = 'El orden debe ser un número entero.';
      categoryFormMessage.hidden = false;
      return;
    }

    // Se guarda exactamente el valor introducido — no se reordenan ni se
    // ajustan automáticamente las demás categorías (el proyecto no tiene
    // hoy ningún mecanismo explícito para eso, y esta etapa no agrega uno).
    const payload = {
      nav_label: navLabel,
      footer_label: footerLabel,
      eyebrow,
      heading,
      description,
      type_heading: typeHeading,
      note,
      layout,
      section_modifier: sectionModifier,
      order,
      active,
    };

    const saveBtn = categoryFormSubmitBtn;
    saveBtn.disabled = true;

    try {
      if (isCreating) {
        const { data, error } = await client
          .from('categories')
          .insert({ id: newId, slug: newSlug, anchor_id: newAnchorId, ...payload })
          .select();

        if (error) {
          showPanelMessage(describeSupabaseError(error), true);
          return;
        }
        if (!data || data.length === 0) {
          showPanelMessage('Supabase no devolvió la categoría creada. Es probable que la política de seguridad (RLS) haya rechazado la operación.', true);
          return;
        }

        showPanelMessage(`Categoría "${navLabel}" (id: ${newId}) creada correctamente.`, false);
        closeCategoryForm();
        await loadPanelData();
      } else {
        const { data, error } = await client
          .from('categories')
          .update(payload)
          .eq('id', editingCategoryId)
          .select();

        if (error) {
          showPanelMessage(describeSupabaseError(error), true);
          return;
        }
        if (!data || data.length === 0) {
          // Igual que en products/product_variants: una política RLS de
          // UPDATE que excluye la fila no lanza error, simplemente actualiza
          // 0 filas — hay que detectarlo a mano.
          showPanelMessage('Supabase no aplicó ningún cambio (0 filas afectadas). Es probable que la política de seguridad (RLS) haya rechazado la operación.', true);
          return;
        }

        showPanelMessage(`Categoría "${navLabel}" (id: ${editingCategoryId}) actualizada correctamente.`, false);
        closeCategoryForm();
        await loadPanelData();
      }
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ---------- Activar/desactivar rápido desde la lista de categorías ----------
   * Solo cambia active=false/true. Nunca elimina la categoría, nunca toca
   * products ni product_variants — el catálogo público ya deja de mostrar
   * una categoría inactiva por su propio mecanismo existente (RLS
   * public_read_categories filtra por active=true, y buildCategorySection
   * en js/render.js solo recorre las categorías que loadCategories()
   * devolvió).
   */
  async function handleToggleCategoryActive(categoryId, newActive, checkboxEl) {
    checkboxEl.disabled = true;

    const { data, error } = await client
      .from('categories')
      .update({ active: newActive })
      .eq('id', categoryId)
      .select();

    if (error) {
      checkboxEl.checked = !newActive;
      showPanelMessage(describeSupabaseError(error), true);
      checkboxEl.disabled = false;
      return;
    }
    if (!data || data.length === 0) {
      checkboxEl.checked = !newActive;
      showPanelMessage('Supabase no aplicó el cambio (0 filas afectadas) — probablemente la política de seguridad (RLS) rechazó la operación.', true);
      checkboxEl.disabled = false;
      return;
    }

    const updatedLabel = data[0].nav_label;
    showPanelMessage(`Categoría "${updatedLabel}" marcada como ${newActive ? 'activa' : 'inactiva'}.`, false);
    const idx = currentCategories.findIndex((c) => c.id === categoryId);
    if (idx !== -1) currentCategories[idx].active = newActive;
    checkboxEl.disabled = false;
  }

  /* ---------- Autenticación y verificación de administrador ---------- */
  async function verifyAdminAndProceed() {
    showView('checking');

    const { data: isAdmin, error } = await client.rpc('is_admin');

    if (error) {
      console.error('[admin.js] Error al verificar permisos de administrador:', error);
      await client.auth.signOut();
      showView('login');
      showLoginError('No se pudo verificar el acceso. Intenta de nuevo.');
      return;
    }

    if (!isAdmin) {
      await client.auth.signOut();
      showView('denied');
      return;
    }

    showView('panel');
    loadPanelData();
  }

  async function init() {
    if (!client) {
      showView('login');
      showLoginError('No se pudo inicializar la conexión con Supabase. Revisa tu conexión a internet y recarga la página.');
      return;
    }

    const { data: { session } } = await client.auth.getSession();
    if (session) {
      await verifyAdminAndProceed();
    } else {
      showView('login');
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;

    if (!client) {
      showLoginError('No se pudo inicializar la conexión con Supabase.');
      return;
    }

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      showLoginError('Correo o contraseña incorrectos.');
      return;
    }

    await verifyAdminAndProceed();
  });

  logoutBtn.addEventListener('click', async () => {
    await client.auth.signOut();
    showView('login');
  });

  deniedBackBtn.addEventListener('click', () => {
    showView('login');
  });

  /* ---------- Eventos del formulario de producto ---------- */
  newProductBtn.addEventListener('click', () => {
    openProductForm('create');
  });

  productFormCancelBtn.addEventListener('click', () => {
    closeProductForm();
  });

  document.getElementById('pf-price-mode').addEventListener('change', updatePriceFieldsVisibility);

  // Vista previa del id mientras se escribe el nombre (solo modo "crear" —
  // en modo "editar" el id nunca cambia).
  document.getElementById('pf-name').addEventListener('input', () => {
    if (!editingProductId && !productFormOverlay.hidden) {
      const name = document.getElementById('pf-name').value;
      productIdPreview.textContent = name.trim() ? generateUniqueProductId(name) : '(se genera al escribir el nombre)';
    }
  });

  productForm.addEventListener('submit', handleProductFormSubmit);

  /* ---------- Eventos de "Qué incluye" (Etapa 4C) ---------- */
  productIncludesAddBtn.addEventListener('click', () => {
    addIncludesRow();
  });

  // Delegación de eventos sobre el contenedor de filas: las filas se crean
  // y destruyen dinámicamente, así que un solo listener alcanza para el
  // botón "Eliminar" de cualquiera de ellas, presentes o futuras.
  productIncludesList.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.includes-remove-btn');
    if (!removeBtn) return;
    removeBtn.closest('.includes-row').remove();
  });

  /* ---------- Eventos de "Qué incluye" para variantes (Etapa 4I) ---------- */
  variantIncludesAddBtn.addEventListener('click', () => {
    addVariantIncludesRow();
  });

  variantIncludesList.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.includes-remove-btn');
    if (!removeBtn) return;
    removeBtn.closest('.includes-row').remove();
  });

  // Delegación de eventos sobre el tbody de productos: el tbody se vacía y
  // se vuelve a llenar en cada renderProducts(), pero el <tbody> en sí nunca
  // se reemplaza, así que un solo listener alcanza para todas las filas.
  document.querySelector('#products-table tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-product-btn');
    if (editBtn) {
      const tr = editBtn.closest('tr');
      const productId = tr.dataset.productId;
      const product = currentProducts.find((p) => p.id === productId);
      if (product) openProductForm('edit', product);
      return;
    }
    // Etapa 4D: disponible para todos los productos, tengan o no variantes.
    const imagesBtn = e.target.closest('.manage-product-images-btn');
    if (imagesBtn) {
      const tr = imagesBtn.closest('tr');
      const productId = tr.dataset.productId;
      openProductImagesModal(productId);
      return;
    }
    const deleteBtn = e.target.closest('.delete-product-btn');
    if (deleteBtn) {
      const tr = deleteBtn.closest('tr');
      const productId = tr.dataset.productId;
      openDeleteProductConfirm(productId);
    }
  });

  document.querySelector('#products-table tbody').addEventListener('change', (e) => {
    if (!e.target.classList.contains('active-toggle')) return;
    const tr = e.target.closest('tr');
    const productId = tr.dataset.productId;
    handleToggleActive(productId, e.target.checked, e.target);
  });

  /* ---------- Eventos del formulario de variante (Etapa 2) ---------- */
  newVariantBtn.addEventListener('click', () => {
    openVariantForm('create');
  });

  variantFormCancelBtn.addEventListener('click', () => {
    closeVariantForm();
  });

  document.getElementById('vf-price-mode').addEventListener('change', updateVariantPriceFieldsVisibility);
  document.getElementById('vf-product').addEventListener('change', refreshVariantIdPreview);
  document.getElementById('vf-name').addEventListener('input', refreshVariantIdPreview);

  variantForm.addEventListener('submit', handleVariantFormSubmit);

  document.querySelector('#variants-table tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-variant-btn');
    if (editBtn) {
      const tr = editBtn.closest('tr');
      const variantId = tr.dataset.variantId;
      const found = findVariantById(variantId);
      if (found) openVariantForm('edit', found.variant);
      return;
    }
    const imagesBtn = e.target.closest('.manage-images-btn');
    if (imagesBtn) {
      const tr = imagesBtn.closest('tr');
      const variantId = tr.dataset.variantId;
      openVariantImagesModal(variantId);
      return;
    }
    const deleteBtn = e.target.closest('.delete-variant-btn');
    if (deleteBtn) {
      const tr = deleteBtn.closest('tr');
      const variantId = tr.dataset.variantId;
      openDeleteVariantConfirm(variantId);
    }
  });

  /* ---------- Eventos de "Contenido del catálogo" (Etapa 5) ---------- */
  siteSectionFormCancelBtn.addEventListener('click', () => {
    closeSiteSectionForm();
  });

  siteSectionForm.addEventListener('submit', handleSiteSectionFormSubmit);

  document.querySelector('#site-sections-table tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-site-section-btn');
    if (!editBtn) return;
    const tr = editBtn.closest('tr');
    const key = tr.dataset.sectionKey;
    const section = currentSiteSections.find((s) => s.key === key);
    if (section) openSiteSectionForm(section);
  });

  document.querySelector('#variants-table tbody').addEventListener('change', (e) => {
    if (!e.target.classList.contains('variant-active-toggle')) return;
    const tr = e.target.closest('tr');
    const variantId = tr.dataset.variantId;
    handleToggleVariantActive(variantId, e.target.checked, e.target);
  });

  /* ---------- Eventos del modal de imágenes de variante (Etapa 3) ---------- */
  variantImagesCloseBtn.addEventListener('click', () => {
    closeVariantImagesModal();
  });

  newVariantImageBtn.addEventListener('click', () => {
    openVariantImageForm('create');
  });

  variantImageFormCancelBtn.addEventListener('click', () => {
    closeVariantImageForm();
  });

  variantImageForm.addEventListener('submit', handleVariantImageFormSubmit);

  document.getElementById('variant-images-list').addEventListener('click', (e) => {
    const editImgBtn = e.target.closest('.edit-image-btn');
    if (editImgBtn) {
      const row = editImgBtn.closest('.image-row');
      const imageId = row.dataset.imageId;
      const image = findImageById(currentImagesVariantId, imageId);
      if (image) openVariantImageForm('edit', image);
      return;
    }
    const primaryBtn = e.target.closest('.set-primary-btn');
    if (primaryBtn) {
      const row = primaryBtn.closest('.image-row');
      const imageId = row.dataset.imageId;
      handleSetPrimaryClick(imageId, currentImagesVariantId);
    }
  });

  document.getElementById('variant-images-list').addEventListener('change', (e) => {
    if (!e.target.classList.contains('image-active-toggle')) return;
    const row = e.target.closest('.image-row');
    const imageId = row.dataset.imageId;
    handleToggleImageActive(imageId, e.target.checked, e.target);
  });

  /* ---------- Eventos del modal de imágenes de producto (Etapa 4D) ---------- */
  productImagesCloseBtn.addEventListener('click', () => {
    closeProductImagesModal();
  });

  newProductImageBtn.addEventListener('click', () => {
    openProductImageForm('create');
  });

  productImageFormCancelBtn.addEventListener('click', () => {
    closeProductImageForm();
  });

  productImageForm.addEventListener('submit', handleProductImageFormSubmit);

  document.getElementById('product-images-list').addEventListener('click', (e) => {
    const editImgBtn = e.target.closest('.edit-product-image-btn');
    if (editImgBtn) {
      const row = editImgBtn.closest('.image-row');
      const imageId = row.dataset.imageId;
      const image = findProductImageById(currentImagesProductId, imageId);
      if (image) openProductImageForm('edit', image);
      return;
    }
    const primaryBtn = e.target.closest('.set-primary-product-image-btn');
    if (primaryBtn) {
      const row = primaryBtn.closest('.image-row');
      const imageId = row.dataset.imageId;
      handleSetPrimaryProductImageClick(imageId, currentImagesProductId);
    }
  });

  document.getElementById('product-images-list').addEventListener('change', (e) => {
    if (!e.target.classList.contains('product-image-active-toggle')) return;
    const row = e.target.closest('.image-row');
    const imageId = row.dataset.imageId;
    handleToggleProductImageActive(imageId, e.target.checked, e.target);
  });

  /* ---------- Eventos de la confirmación de eliminar producto (Etapa 4D) ---------- */
  deleteProductCancelBtn.addEventListener('click', () => {
    closeDeleteProductConfirm();
  });

  deleteProductConfirmBtn.addEventListener('click', () => {
    handleConfirmDeleteProduct();
  });

  /* ---------- Eventos de la confirmación de eliminar variante (Etapa 4E) ---------- */
  deleteVariantCancelBtn.addEventListener('click', () => {
    closeDeleteVariantConfirm();
  });

  deleteVariantConfirmBtn.addEventListener('click', () => {
    handleConfirmDeleteVariant();
  });

  /* ---------- Eventos de la confirmación de eliminar categoría (Etapa 4E) ---------- */
  deleteCategoryCancelBtn.addEventListener('click', () => {
    closeDeleteCategoryConfirm();
  });

  deleteCategoryConfirmBtn.addEventListener('click', () => {
    handleConfirmDeleteCategory();
  });

  /* ---------- Eventos de la tabla y el formulario de categorías (Etapa 4 / 4B) ---------- */
  newCategoryBtn.addEventListener('click', () => {
    openCategoryForm('create');
  });

  document.querySelector('#categories-table tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-category-btn');
    if (editBtn) {
      const tr = editBtn.closest('tr');
      const categoryId = tr.dataset.categoryId;
      const category = findCategoryById(categoryId);
      if (category) openCategoryForm('edit', category);
      return;
    }
    const deleteBtn = e.target.closest('.delete-category-btn');
    if (deleteBtn) {
      const tr = deleteBtn.closest('tr');
      const categoryId = tr.dataset.categoryId;
      openDeleteCategoryConfirm(categoryId);
    }
  });

  document.querySelector('#categories-table tbody').addEventListener('change', (e) => {
    if (!e.target.classList.contains('category-active-toggle')) return;
    const tr = e.target.closest('tr');
    const categoryId = tr.dataset.categoryId;
    handleToggleCategoryActive(categoryId, e.target.checked, e.target);
  });

  categoryFormCancelBtn.addEventListener('click', () => {
    closeCategoryForm();
  });

  categoryForm.addEventListener('submit', handleCategoryFormSubmit);

  init();
})();
