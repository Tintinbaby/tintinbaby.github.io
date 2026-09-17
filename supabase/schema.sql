-- ============================================================
-- Tintín Baby — Esquema de base de datos (Fase 4.2 — revisión de seguridad)
-- ============================================================
-- Estructura de tablas: la misma aprobada en Fase 4.1/4.2 (incluye
-- is_primary en images). NO se modificó ninguna tabla, columna,
-- restricción, índice, trigger ni relación de la versión anterior.
--
-- Lo que cambia en esta revisión es EXCLUSIVAMENTE la sección de
-- seguridad (privilegios + políticas RLS): el acceso administrativo
-- ya no depende únicamente del rol genérico "authenticated" — ahora
-- exige además pertenecer a la tabla admin_users.
--
-- Este script NO fue ejecutado contra ningún proyecto Supabase real —
-- se validó contra un Postgres local de pruebas, vacío y desechable,
-- dentro de este mismo análisis (incluyendo una simulación del
-- esquema "auth" de Supabase y de auth.uid()). Antes de correrlo
-- contra un proyecto real hace falta la aprobación explícita de
-- esta subfase.
-- ============================================================


-- ------------------------------------------------------------
-- Extensión necesaria para gen_random_uuid().
-- En Supabase normalmente ya está habilitada; este comando no
-- hace nada si ya existe.
-- ------------------------------------------------------------
create extension if not exists pgcrypto;


-- ------------------------------------------------------------
-- Función auxiliar: mantiene updated_at al día en cada UPDATE.
-- Se reutiliza en las tres tablas que tienen ese campo.
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ============================================================
-- categories                                    (SIN CAMBIOS)
-- ============================================================
create table categories (
  id                 text primary key,
  slug               text not null unique,
  anchor_id          text not null unique,
  "order"            integer not null default 0,
  active             boolean not null default true,
  nav_label          text not null,
  footer_label       text,
  eyebrow            text,
  heading            text not null,
  description        text,
  layout             text not null
                        check (layout in ('simple-grid', 'variant-carousels')),
  type_heading       text,
  note               text,
  section_modifier   text
                        check (section_modifier is null or section_modifier in ('alt')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_categories_active_order on categories (active, "order");

create trigger trg_categories_updated_at
  before update on categories
  for each row execute function set_updated_at();


-- ============================================================
-- products                                      (SIN CAMBIOS)
-- ============================================================
create table products (
  id                      text primary key,
  category_id             text not null
                             references categories (id)
                             on delete restrict on update restrict,
  "order"                 integer not null default 0,
  active                  boolean not null default true,
  featured                boolean not null default false,
  name                    text not null,
  badge                   text,
  description             text,
  complete_label          text,
  includes                jsonb not null default '[]'::jsonb,
  cta_label               text,
  cta_href                text,
  -- Nullable a propósito: los productos de categorías "variant-carousels"
  -- (Ajuar, Accesorios) no tienen precio propio — cada variante lleva el
  -- suyo. Solo los productos tipo "set" (simple-grid) usan estos campos.
  price_mode              text
                             check (price_mode is null
                                    or price_mode in ('fixed', 'promo', 'consult', 'from')),
  price_amount            numeric(12, 2),
  price_original_amount   numeric(12, 2),
  price_currency          text not null default 'COP',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint chk_products_price_fixed
    check (price_mode <> 'fixed' or price_amount is not null),
  constraint chk_products_price_promo
    check (price_mode <> 'promo'
           or (price_amount is not null and price_original_amount is not null)),
  constraint chk_products_price_consult
    check (price_mode <> 'consult'
           or (price_amount is null and price_original_amount is null))
);

create index idx_products_category on products (category_id);
create index idx_products_category_active_order on products (category_id, active, "order");

create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();


-- ============================================================
-- product_variants                               (SIN CAMBIOS)
-- ============================================================
create table product_variants (
  id                      text primary key,
  product_id              text not null
                             references products (id)
                             on delete cascade on update restrict,
  "order"                 integer not null default 0,
  active                  boolean not null default true,
  name                    text not null,
  description             text,
  -- "Qué incluye" propio de la variante — mismo patrón que products.includes
  -- (ver arriba en este archivo): jsonb con un array de strings, opcional en
  -- el sentido de que el default es un array vacío. Independiente del
  -- includes del producto padre y del de cualquier otra variante.
  includes                jsonb not null default '[]'::jsonb,
  image_alt               text not null default '',
  placeholder_tone        text
                             check (placeholder_tone is null
                                    or placeholder_tone in ('default', 'sage', 'gold')),
  cta_label               text,
  cta_href                text,
  price_mode              text not null
                             check (price_mode in ('fixed', 'promo', 'consult', 'from')),
  price_amount            numeric(12, 2),
  price_original_amount   numeric(12, 2),
  price_currency          text not null default 'COP',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint chk_variants_price_fixed
    check (price_mode <> 'fixed' or price_amount is not null),
  constraint chk_variants_price_promo
    check (price_mode <> 'promo'
           or (price_amount is not null and price_original_amount is not null)),
  constraint chk_variants_price_consult
    check (price_mode <> 'consult'
           or (price_amount is null and price_original_amount is null))
);

create index idx_variants_product_active_order on product_variants (product_id, active, "order");

create trigger trg_variants_updated_at
  before update on product_variants
  for each row execute function set_updated_at();


-- ============================================================
-- images                                         (SIN CAMBIOS)
-- ============================================================
create table images (
  id            uuid primary key default gen_random_uuid(),
  product_id    text
                  references products (id)
                  on delete cascade on update restrict,
  variant_id    text
                  references product_variants (id)
                  on delete cascade on update restrict,
  url           text not null,
  alt           text not null default '',
  "order"       integer not null default 0,
  active        boolean not null default true,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),

  constraint chk_images_single_owner
    check ( (product_id is not null)::int + (variant_id is not null)::int = 1 )
);

create index idx_images_product on images (product_id) where product_id is not null;
create index idx_images_variant on images (variant_id) where variant_id is not null;

create unique index uq_images_one_primary_per_product
  on images (product_id) where is_primary = true and product_id is not null;

create unique index uq_images_one_primary_per_variant
  on images (variant_id) where is_primary = true and variant_id is not null;


-- ============================================================
-- site_sections                                  (NUEVO — Etapa 5)
-- ============================================================
-- Contenido editable de secciones informativas del catálogo público (hoy:
-- "Cómo personalizamos" y "Colección permanente" — ver js/render.js). Tabla
-- deliberadamente genérica: "key" es el único identificador que el código
-- necesita conocer de antemano (render.js decide, por código, en qué
-- elemento del DOM va cada fila). Agregar una sección informativa futura
-- (p. ej. "sobre-nosotros", "materiales", "envios", "preguntas-frecuentes")
-- solo requeriría insertar una fila nueva con su propio "key" — nunca una
-- columna ni una tabla nueva.
--
-- A propósito NO tiene "order": a diferencia de categories/products/
-- product_variants, estas secciones no se generan en un loop — cada una
-- ocupa una posición fija ya definida en index.html/css.styles.css. El
-- orden visual de la página lo sigue decidiendo el HTML, no esta tabla.
create table site_sections (
  key           text primary key,
  eyebrow       text not null default '',
  title         text not null default '',
  description   text not null default '',
  -- NULL a propósito: mientras no haya foto real subida desde Admin, el
  -- catálogo público sigue mostrando el marcador de posición visual que ya
  -- existe hoy (ver .thread-visual / .hero-visual .ph-label en
  -- css/styles.css) — no queda ningún hueco vacío.
  image_url     text,
  image_alt     text not null default '',
  visible       boolean not null default true,
  updated_at    timestamptz not null default now()
);

create trigger trg_site_sections_updated_at
  before update on site_sections
  for each row execute function set_updated_at();


-- ============================================================
-- admin_users                                    (NUEVO — Fase 4.2 revisión)
-- ============================================================
-- Tabla de "lista blanca" de administradores. No es una tabla de
-- perfiles de usuario general (no hay usuarios-clientes) — es,
-- literalmente, la lista de qué usuarios ya autenticados cuentan
-- además como administrador.
--
-- user_id referencia auth.users(id), la tabla que Supabase Auth
-- ya mantiene por su cuenta con cada persona que inicia sesión.
-- Esta tabla se queda vacía hasta que exista una cuenta real de
-- Supabase Auth para el administrador (fase de login, todavía no
-- implementada) — en ese momento se inserta una única fila a mano.
--
-- No tiene ninguna política de acceso público (ni siquiera de
-- lectura): nadie puede leerla ni escribirla a través de la API
-- pública, ni con el rol "anon" ni con el rol "authenticated".
-- Solo es legible desde dentro de la función is_admin() de abajo
-- (que corre con privilegios elevados) o directamente por el
-- rol "postgres"/"service_role" (panel SQL de Supabase).
create table admin_users (
  user_id     uuid primary key,
  created_at  timestamptz not null default now()
);

alter table admin_users enable row level security;
-- Deliberadamente sin ninguna política: con RLS activo y cero
-- políticas, ni "anon" ni "authenticated" pueden ver ni tocar esta
-- tabla bajo ninguna circunstancia, aunque tuvieran GRANT sobre ella
-- (que no lo tienen — ver más abajo). Es la tabla más protegida de
-- todo el esquema, a propósito: es la que decide quién es admin.


-- ------------------------------------------------------------
-- Función auxiliar: ¿la sesión actual es la del administrador?
-- ------------------------------------------------------------
-- SECURITY DEFINER: se ejecuta con los privilegios de quien creó
-- la función (el propietario del esquema, no el rol que la llama),
-- así que puede leer admin_users aunque quien llama a la función
-- (anon o authenticated) no tenga ningún permiso directo sobre esa
-- tabla. "set search_path = public" evita que alguien manipule la
-- función redefiniendo tablas en otro esquema (buena práctica
-- obligatoria en cualquier función SECURITY DEFINER).
--
-- auth.uid() devuelve el UUID del usuario autenticado según el
-- token (JWT) con el que llegó la petición — ver la explicación en
-- el punto 9 de la respuesta sobre por qué esto funciona igual en
-- Supabase real. Si no hay sesión (visitante "anon"), auth.uid()
-- devuelve NULL y la función responde false.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_users where user_id = auth.uid()
  );
$$;

-- Postgres concede EXECUTE sobre funciones nuevas a PUBLIC por
-- defecto; se revoca explícitamente y se concede solo a
-- "authenticated" — un visitante "anon" de todas formas nunca
-- tiene auth.uid() y is_admin() le daría false igual, pero así
-- no queda ninguna superficie sin usar expuesta de más.
revoke execute on function is_admin() from public;
grant execute on function is_admin() to authenticated;


-- ============================================================
-- Privilegios de tabla (independientes de RLS — ver explicación)
-- ============================================================
-- anon:          puede intentar leer, nunca escribir.
-- authenticated: puede intentar leer y escribir A NIVEL DE GRANT,
--                pero eso por sí solo YA NO basta para escribir de
--                verdad — las políticas RLS de abajo exigen además
--                is_admin(). Un "authenticated" que no sea el
--                administrador tiene el permiso de intentarlo y
--                cero filas a las que aplicarlo.
grant select
  on categories, products, product_variants, images, site_sections
  to anon;

grant select, insert, update, delete
  on categories, products, product_variants, images, site_sections
  to authenticated;


-- ============================================================
-- Row Level Security
-- ============================================================
alter table categories       enable row level security;
alter table products         enable row level security;
alter table product_variants enable row level security;
alter table images           enable row level security;
alter table site_sections    enable row level security;

-- ---- Lectura pública (rol "anon", catálogo sin login) ----   (SIN CAMBIOS)
-- Un producto/variante/imagen solo es visible si, además de estar
-- activo él mismo, toda su cadena de dueños también lo está.

create policy public_read_categories on categories
  for select
  to anon
  using (active = true);

create policy public_read_products on products
  for select
  to anon
  using (
    active = true
    and exists (
      select 1 from categories c
      where c.id = products.category_id and c.active = true
    )
  );

create policy public_read_variants on product_variants
  for select
  to anon
  using (
    active = true
    and exists (
      select 1
      from products p
      join categories c on c.id = p.category_id
      where p.id = product_variants.product_id
        and p.active = true and c.active = true
    )
  );

create policy public_read_images on images
  for select
  to anon
  using (
    active = true
    and (
      (product_id is not null and exists (
        select 1
        from products p
        join categories c on c.id = p.category_id
        where p.id = images.product_id
          and p.active = true and c.active = true
      ))
      or
      (variant_id is not null and exists (
        select 1
        from product_variants v
        join products p on p.id = v.product_id
        join categories c on c.id = p.category_id
        where v.id = images.variant_id
          and v.active = true and p.active = true and c.active = true
      ))
    )
  );

-- ---- Lectura y escritura administrativa (rol "authenticated") ----
-- CORREGIDO en esta revisión: antes decía "using (true)" — cualquier
-- sesión autenticada, sin más. Ahora exige además is_admin(), es
-- decir, que esa sesión concreta esté en admin_users. Una sesión
-- "authenticated" que no sea la del administrador ve 0 filas y no
-- puede insertar/actualizar/borrar ninguna.
create policy admin_all_categories on categories
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy admin_all_products on products
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy admin_all_variants on product_variants
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy admin_all_images on images
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- ---- site_sections ----
-- Lectura pública: solo lo que ya está marcado como visible. No depende de
-- ninguna otra tabla (a diferencia de products/product_variants/images,
-- que además exigen que su categoría/producto/variante dueña esté activa).
create policy public_read_site_sections on site_sections
  for select
  to anon
  using (visible = true);

-- Edición administrativa: mismo patrón exacto que las otras cuatro tablas
-- — is_admin() reutilizada tal cual, sin ninguna política ni excepción
-- nueva. Ninguna sesión "authenticated" que no sea la del administrador
-- puede leer ni escribir aquí (ni siquiera las filas invisibles).
create policy admin_all_site_sections on site_sections
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());
