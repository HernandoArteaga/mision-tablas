'use strict';
// Une el motor y la interfaz. Genera:
//  - index.html: la app completa en un solo archivo (GitHub Pages o abrir directo en el navegador).
//  - mision-tablas.html: el contenido que se publica como Artifact en Claude.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const engine = fs.readFileSync(path.join(dir, 'engine.js'), 'utf8');
const tpl = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
if (!tpl.includes('/*__ENGINE__*/')) throw new Error('Falta el marcador del motor');
const page = tpl.replace('/*__ENGINE__*/', () => engine.trim());
fs.writeFileSync(path.join(dir, 'mision-tablas.html'), page);

const cut = page.indexOf('</style>') + '</style>'.length;
const head = page.slice(0, cut).replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n?/, '');
const body = page.slice(cut).trim();
const icon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="16" fill="#FFC53D" stroke="#D99B00" stroke-width="4"/>' +
  '<path d="M22 22l20 20M42 22L22 42" stroke="#1D2A57" stroke-width="7" stroke-linecap="round"/></svg>');
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Práctica adaptativa de las tablas de multiplicar y de dividir del 2 al 9 para niños de 9 años.">
<meta name="theme-color" content="#FCFDFF">
<link rel="icon" href="${icon}">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
${head}
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(dir, 'index.html'), html);

// Revisión de sintaxis de los scripts.
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach(s => { new Function(s); });
console.log(`Listo: index.html (${(html.length / 1024).toFixed(0)} KB), ${scripts.length} scripts con sintaxis válida.`);
