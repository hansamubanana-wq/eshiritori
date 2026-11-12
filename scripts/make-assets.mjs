import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('assets', { recursive: true });
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#f4eee1"/><rect x="100" y="100" width="312" height="312" rx="48" fill="#fffdf9" stroke="#6d5843" stroke-width="16"/><path d="m176 323 17-71 132-132 54 54-132 132z" fill="#e8a950" stroke="#6d5843" stroke-width="14" stroke-linejoin="round"/><path d="m193 252 54 54m62-170 54 54M176 323l35-8-27-27z" fill="#6d5843" stroke="#6d5843" stroke-width="10"/><circle cx="151" cy="160" r="18" fill="#9dbba4"/><circle cx="350" cy="355" r="18" fill="#dca499"/></svg>`;
await writeFile('favicon.svg', icon);
for (const size of [192, 512]) await sharp(Buffer.from(icon)).resize(size, size).png().toFile(`assets/icon-${size}.png`);
await sharp(Buffer.from(icon)).resize(180, 180).png().toFile('assets/apple-touch-icon.png');
const titles = ['絵しりとり', 'お絵描きクイズ', 'お絵描き伝言', 'ワードウルフ', 'タイピング', 'クイズバトル', '神経衰弱'];
const colors = ['#e8a950', '#9dbba4', '#dca499', '#b3a3bf', '#a1b9c9', '#dec382', '#b8bf90'];
const cards = titles.map((title, i) => {
    const x = 68 + (i % 4) * 275, y = 252 + Math.floor(i / 4) * 152;
    return `<g transform="translate(${x} ${y})"><rect width="250" height="125" rx="15" fill="#fffdf9" stroke="#9c826b" stroke-width="3"/><path d="M20 24h210" stroke="${colors[i]}" stroke-width="8" stroke-linecap="round"/><text x="125" y="81" text-anchor="middle" font-family="Meiryo, sans-serif" font-size="24" font-weight="bold" fill="#4a3b32">${title}</text></g>`;
}).join('');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#f4eee1"/><rect x="28" y="28" width="1144" height="574" rx="24" fill="none" stroke="#6d5843" stroke-width="5"/><text x="600" y="160" text-anchor="middle" font-family="Meiryo, sans-serif" font-size="58" font-weight="bold" fill="#4a3b32">マルチプレイゲーム広場</text>${cards}</svg>`;
await sharp(Buffer.from(og)).png().toFile('assets/ogp.png');
console.log('Generated favicon, 192/512 icons, Apple icon and 1200×630 OGP.');
