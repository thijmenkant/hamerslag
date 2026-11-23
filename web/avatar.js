// Tekent een trader-poppetje als SVG-tekst. Wordt gebruikt in de 2D-schermen
// én als textuur in de 3D-zaal.

export function avatarSvg(l = {}, { size = 64, bg = true } = {}) {
  const look = l.look || 'short';
  const skin = l.skin || '#F1C7A5', hair = l.hair || '#6B7280', shirt = l.shirt || '#1E40AF';
  const tie = l.tie || '';
  const brow = (look === 'beanie' || look === 'bald') ? '#3F2A1E' : hair;
  const eye = ['#8D5A3B', '#C68863'].includes(String(skin).toUpperCase()) ? '#3B2416' : '#4B5563';
  const has = (...ks) => ks.includes(look);
  const p = [];
  if (bg) p.push(`<circle cx="32" cy="32" r="32" fill="${l.bg || '#DBEAFE'}"/>`);
  if (has('long')) p.push(`<path d="M18 31 C17 17 24 12.5 32 12.5 C40 12.5 47 17 46 31 L47.5 52 L16.5 52 Z" fill="${hair}"/><path d="M18 31 C17 17 24 12.5 32 12.5 C40 12.5 47 17 46 31 L47.5 52 L16.5 52 Z" fill="#000" opacity=".12"/>`);
  if (has('bob')) p.push(`<path d="M19 40 C16.5 19 24 13 32 13 C40 13 47.5 19 45 40 C43 41 41 40.5 40 39 L24 39 C23 40.5 21 41 19 40 Z" fill="${hair}"/><path d="M19 40 C16.5 19 24 13 32 13 C40 13 47.5 19 45 40 C43 41 41 40.5 40 39 L24 39 C23 40.5 21 41 19 40 Z" fill="#000" opacity=".12"/>`);
  if (has('ponytail')) p.push(`<path d="M41 21 C51 23 52.5 37 46.5 47 C45.5 37 44.5 30 40 26.5 Z" fill="${hair}"/>`);
  p.push(`<path d="M8 64 C10 51 20 46 32 46 C44 46 54 51 56 64 Z" fill="${shirt}"/>`);
  if (tie) p.push(`<path d="M26.5 46.6 L32 58 L37.5 46.6 C35.5 46.2 33.8 46 32 46 C30.2 46 28.5 46.2 26.5 46.6 Z" fill="#F8FAFC"/><path d="M30.9 49 L33.1 49 L34.3 59.5 L32 62.5 L29.7 59.5 Z" fill="${tie}"/><path d="M30.6 47.2 L33.4 47.2 L33 49.4 L31 49.4 Z" fill="${tie}"/><path d="M26.5 46.6 L32 58 L28.5 64 L22 64 L24.5 52 L23 47.6 Z" fill="#000" opacity=".18"/><path d="M37.5 46.6 L32 58 L35.5 64 L42 64 L39.5 52 L41 47.6 Z" fill="#000" opacity=".18"/>`);
  else p.push(`<path d="M26 46.8 Q32 52.5 38 46.8 Q35 46 32 46 Q29 46 26 46.8 Z" fill="#000" opacity=".18"/><path d="M27 46.6 Q32 50.8 37 46.6 Q34.5 46.1 32 46.1 Q29.5 46.1 27 46.6 Z" fill="${skin}"/>`);
  p.push(`<path d="M8 64 C9 57 12 53 16 50.5 C14 55 13.5 60 14 64 Z" fill="#000" opacity=".1"/>`);
  p.push(`<rect x="28" y="36.5" width="8" height="11" rx="3.5" fill="${skin}"/><path d="M28 39.5 L36 39.5 L36 43.5 Q32 45.2 28 43.5 Z" fill="#000" opacity=".13"/>`);
  p.push(`<ellipse cx="20.9" cy="30.5" rx="2.3" ry="3.3" fill="${skin}"/><ellipse cx="43.1" cy="30.5" rx="2.3" ry="3.3" fill="${skin}"/>`);
  p.push(`<path d="M32 16.2 C38.6 16.2 43.2 21.4 43.2 29 C43.2 36.5 38.5 42 32 42 C25.5 42 20.8 36.5 20.8 29 C20.8 21.4 25.4 16.2 32 16.2 Z" fill="${skin}"/>`);
  p.push(`<path d="M37.5 18 C42 21 44 31 38 40.5 C41 35 41.5 25 37.5 18 Z" fill="#000" opacity=".08"/>`);
  if (has('short', 'bun', 'ponytail')) p.push(`<path d="M20.6 28 C19.5 17 26 13.3 32 13.3 C39 13.3 45 17.5 43.4 28 C42.6 24.8 41.5 22.5 39.5 21.2 C36 22.6 28 22.6 24.4 21.4 C22.4 22.8 21.2 25 20.6 28 Z" fill="${hair}"/><path d="M26 15.8 C29 14.4 34 14.2 37.5 15.6 C34 15.4 30 15.6 26 17.4 Z" fill="#fff" opacity=".18"/>`);
  if (has('slick')) p.push(`<path d="M20.5 27.5 C19.8 16 27 12.6 33 13.1 C40 13.6 45 18 43.5 27.5 C42.8 23 41 20.5 38.5 19.6 C34 19.2 27 19.8 22.8 22.6 C21.6 24 21 25.6 20.5 27.5 Z" fill="${hair}"/><path d="M25 17.6 C29 15 35.5 14.4 40 16.4 C35 16 29.5 16.6 25 19.4 Z" fill="#fff" opacity=".2"/>`);
  if (has('spiky')) p.push(`<path d="M20.5 27.5 L20.8 17.5 L25 19.5 L26.6 12 L30.6 16.6 L33.8 10.4 L36.8 16.6 L41.4 13.2 L43.5 27.5 C42.6 24 41.4 22 39.2 21 C35 22.4 28.6 22.4 24.6 21.2 C22.5 22.4 21.2 24.6 20.5 27.5 Z" fill="${hair}"/>`);
  if (has('long', 'bob')) p.push(`<path d="M20.8 28 C20.6 18 26.6 14.2 32.5 14.2 C38.6 14.2 44 18.4 43.3 28 C41.5 23.6 39.5 21.6 36.5 20.8 C33 22.4 26 24.4 20.8 28 Z" fill="${hair}"/>`);
  if (has('bun')) p.push(`<circle cx="32" cy="10.8" r="6" fill="${hair}"/>`);
  if (has('curly')) p.push(`<path d="M19.6 29 C18 25 18.6 21 21.6 19.2 C22 14.4 26.6 12.2 29.8 13.6 C32.4 10.8 37.6 11.2 39.6 14.6 C43.2 15.4 45.8 19 44.4 23.2 C45.8 25.4 45.4 27.6 44.4 29 C43.2 25 41.4 22.8 38.6 21.6 C35 23 28.6 23 25.4 21.8 C22.6 23 20.8 25.6 19.6 29 Z" fill="${hair}"/>`);
  if (has('beanie')) p.push(`<path d="M19.8 26 C19.8 15 26 10.8 32 10.8 C38 10.8 44.2 15 44.2 26 Z" fill="${hair}"/><rect x="19" y="22.6" width="26" height="5.4" rx="2.7" fill="${hair}"/><rect x="19" y="22.6" width="26" height="5.4" rx="2.7" fill="#000" opacity=".2"/>`);
  if (has('bald')) p.push(`<path d="M20.6 30.5 C20.3 25.5 21.6 22.6 23.6 21.6 L23.4 30.8 Z" fill="${hair}"/><path d="M43.4 30.5 C43.7 25.5 42.4 22.6 40.4 21.6 L40.6 30.8 Z" fill="${hair}"/><ellipse cx="29" cy="19.5" rx="4.5" ry="2" fill="#fff" opacity=".2"/>`);
  if (l.beard) p.push(`<path d="M21.6 30.5 C21.6 41 26.5 45.4 32 45.4 C37.5 45.4 42.4 41 42.4 30.5 C41.2 35.6 37.6 38.4 32 38.4 C26.4 38.4 22.8 35.6 21.6 30.5 Z" fill="${hair}"/><path d="M28.2 35.6 Q32 33.8 35.8 35.6 Q32 37 28.2 35.6 Z" fill="${hair}"/>`);
  p.push(`<path d="M24.6 26.4 Q27.4 24.8 30.4 26 L30.2 27.1 Q27.4 26 24.9 27.3 Z" fill="${brow}"/><path d="M33.6 26 Q36.6 24.8 39.4 26.4 L39.1 27.3 Q36.6 26 33.8 27.1 Z" fill="${brow}"/>`);
  p.push(`<ellipse cx="27.6" cy="30.2" rx="2.3" ry="1.6" fill="#fff"/><ellipse cx="36.4" cy="30.2" rx="2.3" ry="1.6" fill="#fff"/><circle cx="27.9" cy="30.2" r="1.3" fill="${eye}"/><circle cx="36.7" cy="30.2" r="1.3" fill="${eye}"/><circle cx="27.9" cy="30.2" r=".6" fill="#0B0B0F"/><circle cx="36.7" cy="30.2" r=".6" fill="#0B0B0F"/><circle cx="28.3" cy="29.8" r=".35" fill="#fff"/><circle cx="37.1" cy="29.8" r=".35" fill="#fff"/>`);
  p.push(`<path d="M32.4 30.6 L33.6 35.2 Q32.4 36 30.9 35.4 Q32 35.3 32.6 34.8 Z" fill="#000" opacity=".13"/><ellipse cx="25.4" cy="35" rx="2.4" ry="1.5" fill="#F43F5E" opacity=".1"/><ellipse cx="38.6" cy="35" rx="2.4" ry="1.5" fill="#F43F5E" opacity=".1"/>`);
  p.push(`<path d="M28.9 37.6 Q32 39.9 35.1 37.6 Q32 38.5 28.9 37.6 Z" fill="#9F3F3A"/>`);
  if (l.glasses) p.push(`<path fill-rule="evenodd" d="M23.6 28.2 Q23.6 26.8 25 26.8 L30.4 26.8 Q31.4 26.8 31.3 28 L31 31.4 Q30.8 33.4 28.6 33.4 L26 33.4 Q24 33.4 23.8 31.4 Z M24.6 28.4 L24.8 31.2 Q25 32.4 26.2 32.4 L28.5 32.4 Q29.9 32.4 30 31.2 L30.3 28.2 Q30.3 27.8 29.9 27.8 L25.2 27.8 Q24.6 27.8 24.6 28.4 Z" fill="#1F2937"/><path fill-rule="evenodd" d="M40.4 28.2 Q40.4 26.8 39 26.8 L33.6 26.8 Q32.6 26.8 32.7 28 L33 31.4 Q33.2 33.4 35.4 33.4 L38 33.4 Q40 33.4 40.2 31.4 Z M39.4 28.4 L39.2 31.2 Q39 32.4 37.8 32.4 L35.5 32.4 Q34.1 32.4 34 31.2 L33.7 28.2 Q33.7 27.8 34.1 27.8 L38.8 27.8 Q39.4 27.8 39.4 28.4 Z" fill="#1F2937"/><rect x="31" y="28" width="2" height="1.1" fill="#1F2937"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${p.join('')}</svg>`;
}

export const avatarUrl = (look, opts) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(avatarSvg(look, opts));
