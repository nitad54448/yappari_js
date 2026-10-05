/* Minimal DOMParser for Node tests (no dependencies): elements, attributes, text, CDATA, comments, entities.
 * Enough for <impedanceFormat> definitions; malformed XML yields a document whose querySelector('parsererror') is set. */
'use strict';
const ent = s => s.replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
class El {
  constructor(tag, attrs) { this.tagName = tag; this.attributes = attrs; this.children = []; this.parts = []; }
  get textContent() { return this.parts.map(p => typeof p === 'string' ? p : p.textContent).join(''); }
  hasAttribute(n) { return this.attributes.some(a => a.name === n); }
  getAttribute(n) { const a = this.attributes.find(a => a.name === n); return a ? a.value : null; }
  querySelector(q) {
    const names = q.split(',').map(s => s.trim());
    for (const c of this.children) { if (names.includes(c.tagName)) return c; const f = c.querySelector(q); if (f) return f; }
    return null;
  }
}
function parse(text) {
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  const stack = [], roots = []; let m, doctype = false;
  while ((m = re.exec(text))) {
    if (m[7]) throw Error('stray <');
    if (m[0].startsWith('<!DOCTYPE')) { doctype = true; continue; }
    if (m[0].startsWith('<!--') || m[0].startsWith('<?')) continue;
    const top = stack[stack.length - 1];
    if (m[1] != null) { if (!top) throw Error('cdata outside root'); top.parts.push(m[1]); continue; }
    if (m[2]) { if (!top || top.tagName !== m[2]) throw Error('mismatched </' + m[2] + '>'); stack.pop(); continue; }
    if (m[3]) {
      const attrs = [], ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let a;
      while ((a = ar.exec(m[4]))) { if (attrs.some(x => x.name === a[1])) throw Error('duplicate attribute'); attrs.push({ name: a[1], value: ent(a[2] != null ? a[2] : a[3]) }); }
      const el = new El(m[3], attrs);
      if (top) { top.children.push(el); top.parts.push(el); } else roots.push(el);
      if (!m[5]) stack.push(el);
      continue;
    }
    if (m[6] != null) { if (top) top.parts.push(ent(m[6])); else if (m[6].trim()) throw Error('text outside root'); }
  }
  if (stack.length || roots.length !== 1) throw Error('unbalanced XML');
  return { documentElement: roots[0], doctype };
}
globalThis.DOMParser = class {
  parseFromString(text) {
    try { const d = parse(text); return { documentElement: d.documentElement, doctype: d.doctype ? {} : null, querySelector: q => q === 'parsererror' ? null : d.documentElement.querySelector(q) }; }
    catch (e) { return { documentElement: null, doctype: null, querySelector: q => q === 'parsererror' ? {} : null }; }
  }
};
