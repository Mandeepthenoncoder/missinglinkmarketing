import { createPitScene } from './pitstop.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const html = document.documentElement;
const body = document.body;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = window.matchMedia('(hover: hover)').matches;

// =========================================================
// Hero: the pit stop plays once, on load. The copy lands on the story's beats:
// the problem while the car waits, "Linked." as the missing wheel locks on.
// =========================================================
const hero = $('.hero');
const header = $('.site-header');
const canvas = $('#pit-canvas');
const replay = $('.hero-replay');
const stage = (n) => hero.classList.add(`s${n}`);
const beats = {
  title: () => stage(1),
  header: () => header.classList.add('is-ready'),
  lead: () => stage(2),
  lock: () => stage(3),
  end: () => { replay.hidden = false; },
};
let pit = null;
try {
  pit = createPitScene(canvas, { reducedMotion, onBeat: (name) => beats[name] && beats[name]() });
} catch (err) {
  console.warn('WebGL unavailable, showing the static logo', err);
  canvas.hidden = true;
  $('.hero-fallback').classList.add('is-on');
}
if (!pit || reducedMotion) {
  ['s1', 's2', 's3'].forEach((c) => hero.classList.add(c));
  header.classList.add('is-ready');
}
if (pit) {
  if (location.search.includes('debug')) window.pit = pit;
  replay.addEventListener('click', () => { replay.hidden = true; pit.replay(); });
  hero.addEventListener('pointermove', (e) => {
    pit.state.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    pit.state.mouseY = (e.clientY / window.innerHeight - 0.5) * -2;
  });
  // the 3D only renders while the hero is on screen
  new IntersectionObserver(([en]) => pit.setActive(en.isIntersecting)).observe(hero);
}

// the header sits on the night hero, then turns to paper once the hero has scrolled away
new IntersectionObserver(([en]) => {
  header.dataset.tone = en.isIntersecting ? 'night' : 'paper';
}, { rootMargin: '-72px 0px 0px 0px', threshold: 0 }).observe(hero);

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
