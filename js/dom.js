export const $ = (id) => document.getElementById(id);

export function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

export function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}