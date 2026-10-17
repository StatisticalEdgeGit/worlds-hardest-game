'use strict';

/* Draws a join QR code for the play launcher.
   Usage: node show_qr.js <url> <html-path>
   Prints a terminal QR code and writes a page with a large one. */

const fs = require('fs');
const QRCode = require('qrcode');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/* The terminal code, two modules per character (top and bottom half), black on bright
   white. The 4-module white border is the quiet zone phone cameras need to find the code
   against a dark terminal; qrcode's own terminal output only leaves one. */
function terminalQr(text) {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
  const quiet = 4;
  const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && !!data[y * size + x];
  const lines = [];
  for (let y = -quiet; y < size + quiet; y += 2) {
    let line = '';
    for (let x = -quiet; x < size + quiet; x++) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(`  \x1b[30;107m${line}\x1b[0m`);
  }
  return lines.join('\n');
}

async function main() {
  const url = process.argv[2];
  const htmlPath = process.argv[3];
  if (!url || !htmlPath) {
    console.error('Usage: node show_qr.js <url> <html-path>');
    process.exit(1);
  }

  process.stdout.write(`${terminalQr(url)}\n`);

  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 640,
    color: { dark: '#000000', light: '#ffffff' },
  });
  const safeUrl = escapeHtml(url);
  const localUrl = escapeHtml(url.replace(/\/\/[^/:]+/, '//127.0.0.1'));
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scan to play World's Hardest Game</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #07070d;
      color: #f4f1ff;
      font-family: "Segoe UI", system-ui, sans-serif;
    }
    main { text-align: center; padding: 28px 20px 40px; max-width: 640px; }
    .eyebrow { letter-spacing: 0.16em; text-transform: uppercase; font-size: 12px; color: #b9a6ff; margin: 0; }
    h1 { font-size: 40px; line-height: 1.05; margin: 8px 0 18px; }
    .card { background: #fff; display: inline-block; padding: 12px; border-radius: 18px; }
    img { display: block; width: min(78vw, 520px); height: auto; }
    a { color: #d7ff4a; }
    .local {
      display: inline-block;
      margin-top: 8px;
      padding: 10px 16px;
      border-radius: 999px;
      background: #d7ff4a;
      color: #14140f;
      text-decoration: none;
      font-weight: 650;
    }
    ol { text-align: left; margin: 22px auto 0; padding-left: 22px; line-height: 1.45; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Same Wi-Fi</p>
    <h1>Scan to play</h1>
    <div class="card"><img src="${dataUrl}" alt="QR code for ${safeUrl}"></div>
    <p><a href="${safeUrl}">${safeUrl}</a></p>
    <p><a class="local" href="${localUrl}">Play on this computer</a></p>
    <ol>
      <li>Each player picks a name on the title screen.</li>
      <li>On this computer, tap Host. A 4-letter room code appears.</li>
      <li>Friends tap Join and type that code.</li>
      <li>The host taps Start race.</li>
    </ol>
  </main>
</body>
</html>
`;
  fs.writeFileSync(htmlPath, html);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
