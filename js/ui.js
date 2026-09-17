/* ui.js
 * Mismo comportamiento que existía antes en línea dentro de index.html:
 * - Carruseles (botones prev/next)
 * - Reveal on scroll (IntersectionObserver)
 * - Scroll suave para anchors internos
 * - Menú móvil
 *
 * Se usa delegación de eventos para los carruseles y los anchors porque
 * las tarjetas y botones de categoría/producto ahora se generan de forma
 * dinámica (ver render.js) después de que este script se ejecuta. El
 * comportamiento resultante es idéntico al original.
 */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.cnav');
  if (!btn) return;
  const track = document.getElementById(btn.dataset.target);
  if (!track) return;
  const card = track.querySelector('.card, .set-card');
  const step = card ? card.offsetWidth + 24 : 300;
  track.parentElement.scrollBy({ left: btn.classList.contains('next') ? step : -step, behavior: 'smooth' });
});

function initRevealObserver() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href === '#') return; // '#' no es un selector valido
  const target = document.querySelector(href);
  if (target) {
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

function initMenuToggle() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.getElementById('navlinks');
  if (!menuToggle || !navLinks) return;

  const setMenu = (open) => {
    navLinks.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuToggle.textContent = open ? '\u2715' : '\u2630';
  };

  menuToggle.addEventListener('click', () => setMenu(!navLinks.classList.contains('open')));

  // Delegaci\u00f3n de eventos (no listeners por <a>): los enlaces de categor\u00eda
  // ahora los inserta render.js de forma as\u00edncrona, despu\u00e9s de que este
  // handler se registra, as\u00ed que no pueden enlazarse uno por uno.
  navLinks.addEventListener('click', (e) => {
    if (e.target.closest('a')) setMenu(false);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initMenuToggle();
  initRevealObserver(); // observa los .reveal estáticos ya presentes (hero, strip, personalize, quote)
});

// El catálogo se inyecta de forma asíncrona (fetch de JSON); cuando termina,
// hay que volver a observar para incluir los nuevos elementos .reveal
// (section-head, type-head, cards, set-cards) que no existían todavía.
document.addEventListener('catalog:rendered', initRevealObserver);
