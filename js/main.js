import { createChainScene } from './scene.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const html = document.documentElement;
const body = document.body;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = window.matchMedia('(hover: hover)').matches;

// =========================================================
// Hero: the chain completes itself once, on load
// =========================================================
const hero = $('.hero');
const header = $('.site-header');
const canvas = $('#chain-canvas');
let chain = null;
try {
  chain = createChainScene(canvas, { reducedMotion });
} catch (err) {
  console.warn('WebGL unavailable, showing the static logo', err);
  canvas.hidden = true;
  $('.hero-fallback').classList.add('is-on');
}

function stage(n) { hero.classList.add(`s${n}`); }

if (reducedMotion || !window.gsap) {
  ['s1', 's2', 's3'].forEach((c) => hero.classList.add(c));
  header.classList.add('is-ready');
  if (chain) { chain.state.intro = 1; chain.state.progress = 1; }
} else {
  const { gsap } = window;
  const tl = gsap.timeline({ delay: 0.2 });
  // 1. the two chains slide in from the sides, a gap between them
  if (chain) tl.to(chain.state, { intro: 1, duration: 2, ease: 'power3.out' }, 0);
  // 2. the headline and the header arrive while they settle
  tl.add(() => stage(1), 0.45)
    .add(() => header.classList.add('is-ready'), 0.8)
    .add(() => stage(2), 1.2);
  // 3. the magenta link flies in and locks; the answer line lands with it
  if (chain) {
    tl.to(chain.state, {
      progress: 1, duration: 3.4, ease: 'power1.inOut',
      onUpdate() { if (chain.state.progress > 0.8) stage(3); },
    }, 0.7);
  } else tl.add(() => stage(3), 2.6);
}

// hint that follows the cursor over the chain, and a little parallax
if (chain) {
  const chip = $('.cursor-chip');
  canvas.addEventListener('chainhover', (e) => {
    chip.textContent = e.detail === 'key' ? 'Click to pulse the link' : 'Drag to turn';
    chip.classList.toggle('is-on', Boolean(e.detail));
    chip.classList.toggle('is-key', e.detail === 'key');
  });
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    chip.style.transform = `translate(${e.clientX - r.left + 18}px, ${e.clientY - r.top + 18}px)`;
    chain.state.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    chain.state.mouseY = (e.clientY / window.innerHeight - 0.5) * -2;
  });
  hero.addEventListener('pointerleave', () => chip.classList.remove('is-on'));
}

// the header sits on the night hero, then turns to paper once the hero has scrolled away;
// the 3D only renders while the hero is on screen
new IntersectionObserver(([en]) => {
  header.dataset.tone = en.isIntersecting ? 'night' : 'paper';
}, { rootMargin: '-72px 0px 0px 0px', threshold: 0 }).observe(hero);
if (chain) new IntersectionObserver(([en]) => chain.setActive(en.isIntersecting)).observe(hero);

// =========================================================
// Reveal once, from a visible default; siblings follow one another
// =========================================================
const revealIO = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    en.target.classList.add('is-seen');
    revealIO.unobserve(en.target);
  });
}, { rootMargin: '0px 0px -12% 0px' });
$$('[data-reveal]').forEach((el) => {
  const sibs = [...el.parentElement.children].filter((c) => c.hasAttribute('data-reveal'));
  el.style.setProperty('--d', `${Math.min(sibs.indexOf(el), 4) * 0.08}s`);
  revealIO.observe(el);
});

// the three strengths link up, one after another, when the band comes into view
const strengths = $('.strengths');
new IntersectionObserver(([en], io) => {
  if (!en.isIntersecting) return;
  io.disconnect();
  [1, 2, 3].forEach((i) => setTimeout(() => strengths.classList.add(`lit-${i}`), 250 + i * 320));
  setTimeout(() => strengths.classList.remove('lit-1', 'lit-2', 'lit-3'), 2800);
}, { threshold: 0.35 }).observe(strengths);

// =========================================================
// Work: a preview of the project follows the cursor
// =========================================================
const preview = $('.project-preview');
if (canHover && preview) {
  $$('.project').forEach((p) => {
    const tone = ['tone-1', 'tone-2', 'tone-3'].find((t) => p.classList.contains(t));
    p.addEventListener('pointerenter', () => {
      preview.classList.remove('tone-1', 'tone-2', 'tone-3');
      preview.classList.add(tone, 'is-on');
    });
    p.addEventListener('pointerleave', () => preview.classList.remove('is-on'));
    p.addEventListener('pointermove', (e) => {
      const x = Math.min(e.clientX + 28, window.innerWidth - 320);
      const y = Math.max(16, Math.min(e.clientY - 90, window.innerHeight - 200));
      preview.style.setProperty('--px', `${x}px`);
      preview.style.setProperty('--py', `${y}px`);
    });
  });
}

// =========================================================
// Current section in the nav
// =========================================================
const navLinks = $$('[data-nav]');
const navIO = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    const link = navLinks.find((l) => l.getAttribute('href') === `#${en.target.id}`);
    if (!link) return;
    link.classList.toggle('is-current', en.isIntersecting);
    if (en.isIntersecting) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
  });
}, { rootMargin: '-45% 0px -50% 0px' });
['services', 'work', 'approach', 'team'].forEach((id) => navIO.observe($(`#${id}`)));

// =========================================================
// Links: a service row picks the form's topic; the menu closes on navigation
// =========================================================
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  if (a.dataset.need) $('#f-need').value = a.dataset.need;
  closeMenu();
  if (a.getAttribute('href') === '#diagnostic') setTimeout(() => $('#f-name').focus({ preventScroll: true }), 900);
});

const burger = $('.burger');
const menu = $('#menu');
function closeMenu() {
  if (!body.classList.contains('menu-open')) return;
  body.classList.remove('menu-open');
  burger.setAttribute('aria-expanded', 'false');
  burger.setAttribute('aria-label', 'Open menu');
  menu.setAttribute('aria-hidden', 'true');
}
burger.addEventListener('click', () => {
  if (body.classList.contains('menu-open')) return closeMenu();
  body.classList.add('menu-open');
  burger.setAttribute('aria-expanded', 'true');
  burger.setAttribute('aria-label', 'Close menu');
  menu.setAttribute('aria-hidden', 'false');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// =========================================================
// Questions: one answer open at a time
// =========================================================
const items = $$('.qa');
items.forEach((qa) => qa.querySelector('.q').addEventListener('click', () => {
  const open = !qa.classList.contains('is-open');
  items.forEach((o) => { o.classList.remove('is-open'); o.querySelector('.q').setAttribute('aria-expanded', 'false'); });
  qa.classList.toggle('is-open', open);
  qa.querySelector('.q').setAttribute('aria-expanded', String(open));
}));

// =========================================================
// Diagnostic: the form builds the link
// =========================================================
const form = $('.diag-form');
const builder = $('.builder');
const status = $('.builder-status');
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
function updateBuilder() {
  if (builder.classList.contains('has-bar')) return;
  const name = $('#f-name').value.trim();
  const email = $('#f-email').value.trim();
  const org = $('#f-org').value.trim();
  builder.classList.toggle('has-left', Boolean(name));
  builder.classList.toggle('has-right', emailOk(email));
  builder.classList.toggle('has-gap', Boolean(name && emailOk(email) && org));
  const done = [Boolean(name), emailOk(email), Boolean(org)].filter(Boolean).length;
  status.textContent = done === 3 ? 'One link missing. Send the request to complete it.' : `${done} of 3 details in. Fill in the form to complete the link.`;
}
function setError(input, msg) {
  const field = input.closest('.field');
  field.classList.toggle('has-error', Boolean(msg));
  field.querySelector('.field-error').textContent = msg || '';
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
}
function validate(input) {
  const v = input.value.trim();
  if (input.required && !v) return setError(input, `Please add your ${input.labels[0].textContent.toLowerCase()}.`), false;
  if (input.type === 'email' && !emailOk(v)) return setError(input, 'Please enter a valid email, like name@company.com.'), false;
  setError(input, '');
  return true;
}
$$('input', form).forEach((i) => {
  i.addEventListener('input', () => { updateBuilder(); if (i.getAttribute('aria-invalid') === 'true') validate(i); });
  i.addEventListener('blur', () => i.value && validate(i));
});
updateBuilder();
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const inputs = $$('input', form);
  const ok = inputs.map(validate).every(Boolean);
  if (!ok) { inputs.find((i) => i.getAttribute('aria-invalid') === 'true').focus(); return; }
  builder.classList.remove('has-gap');
  builder.classList.add('has-bar');
  status.textContent = 'Link complete. Opening your email app.';
  const d = Object.fromEntries(new FormData(form));
  const bodyText = `Name: ${d.name}\nWork email: ${d.email}\nOrganisation: ${d.org}\nNeeds help with: ${d.need}`;
  const success = $('.form-success', form);
  success.hidden = false;
  success.textContent = `Thanks, ${d.name.split(' ')[0]}. Your email app is opening with the request addressed to hello@mlinkm.com.`;
  setTimeout(() => {
    window.location.href = `mailto:hello@mlinkm.com?subject=${encodeURIComponent('Diagnostic request from ' + d.org)}&body=${encodeURIComponent(bodyText)}`;
  }, 900);
});
