/**
 * Generates PWA icons from static/icon.svg.
 * Replace static/icon.svg with your brand artwork, then: pnpm run generate:pwa-icons
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const staticDir = join(root, 'static');
const svg = readFileSync(join(staticDir, 'icon.svg'));

const BRAND = { r: 79, g: 70, b: 229, alpha: 1 };

async function writeIcon(size, filename, { maskable = false } = {}) {
	const out = join(staticDir, filename);
	if (!maskable) {
		await sharp(svg).resize(size, size).png().toFile(out);
		return;
	}

	const inner = Math.round(size * 0.62);
	const offset = Math.round((size - inner) / 2);
	const innerBuf = await sharp(svg).resize(inner, inner).png().toBuffer();

	await sharp({
		create: { width: size, height: size, channels: 4, background: BRAND }
	})
		.composite([{ input: innerBuf, top: offset, left: offset }])
		.png()
		.toFile(out);
}

await writeIcon(32, 'favicon-32.png');
await writeIcon(180, 'apple-touch-icon.png');
await writeIcon(192, 'pwa-192.png');
await writeIcon(512, 'pwa-512.png');
await writeIcon(512, 'pwa-512-maskable.png', { maskable: true });

console.log('PWA icons written to static/');
