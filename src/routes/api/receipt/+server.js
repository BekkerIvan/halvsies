import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const EXTRACTION_PROMPT = `You are a receipt parser. Extract every purchasable line item from the receipt image.

Return ONLY valid JSON with this shape:
{
  "currency": "EUR" | "USD" | "GBP" | string,
  "items": [
    {
      "name": string,
      "quantity": number,
      "unitPrice": number,
      "lineTotal": number
    }
  ],
  "subtotal": number | null,
  "tax": number | null,
  "tip": number | null,
  "total": number | null
}

Rules:
- Use decimal numbers (e.g. 12.50), not currency symbols in numeric fields.
- quantity defaults to 1 when not shown.
- lineTotal should match quantity * unitPrice when possible.
- Ignore payment method lines, change, subtotal/total summary lines as items (only real products/services).
- If unsure about a line, include your best guess.`;

/** @param {string} text */
function parseJsonFromModelText(text) {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
	const jsonString = fenced ? fenced[1].trim() : trimmed;
	return JSON.parse(jsonString);
}

/**
 * @param {unknown} value
 * @returns {value is { arrayBuffer: () => Promise<ArrayBuffer>; type?: string }}
 */
function isBinaryUpload(value) {
	return (
		value != null &&
		typeof value === 'object' &&
		typeof /** @type {{ arrayBuffer?: unknown }} */ (value).arrayBuffer === 'function'
	);
}

/** @param {string} imageBase64 @param {string} mimeType */
function normalizeBase64Image(imageBase64, mimeType) {
	let data = imageBase64.trim();
	let type = mimeType;

	const dataUrlMatch = data.match(/^data:([^;]+);base64,(.+)$/i);
	if (dataUrlMatch) {
		type = dataUrlMatch[1];
		data = dataUrlMatch[2];
	}

	return { imageBase64: data.replace(/\s/g, ''), mimeType: type };
}

/** @param {import('@sveltejs/kit').RequestEvent['request']} request */
async function readImageFromRequest(request) {
	let imageBase64;
	let mimeType = 'image/jpeg';

	const contentType = request.headers.get('content-type') || '';

	if (contentType.includes('application/json')) {
		const body = await request.json();
		imageBase64 = body.image;
		mimeType = body.mimeType || mimeType;
	} else {
		const formData = await request.formData();
		const file = formData.get('image');

		if (typeof file === 'string') {
			return { error: 'Missing image file.' };
		}

		if (!isBinaryUpload(file)) {
			return { error: 'Missing image file.' };
		}

		mimeType = file.type || mimeType;
		const buffer = Buffer.from(await file.arrayBuffer());
		if (!buffer.length) {
			return { error: 'Image file is empty.' };
		}
		imageBase64 = buffer.toString('base64');
	}

	if (!imageBase64 || typeof imageBase64 !== 'string') {
		return { error: 'Missing image data.' };
	}

	const normalized = normalizeBase64Image(imageBase64, mimeType);
	if (!normalized.imageBase64) {
		return { error: 'Missing image data.' };
	}

	return normalized;
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const imagePayload = await readImageFromRequest(request);
	if (imagePayload.error) {
		return json({ error: imagePayload.error }, { status: 400 });
	}

	const { imageBase64, mimeType } = imagePayload;
	const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;

	if (!apiKey) {
		return json({
			mock: true,
			currency: 'EUR',
			items: [
				{ name: 'Margherita pizza', quantity: 1, unitPrice: 14.5, lineTotal: 14.5 },
				{ name: 'Tiramisu', quantity: 2, unitPrice: 6.0, lineTotal: 12.0 },
				{ name: 'Sparkling water', quantity: 1, unitPrice: 3.5, lineTotal: 3.5 }
			],
			subtotal: 30.0,
			tax: 2.4,
			tip: null,
			total: 32.4,
			message:
				'Set GEMINI_API_KEY in .env to parse real receipts. Showing sample data for now.'
		});
	}

	const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-goog-api-key': apiKey
		},
		body: JSON.stringify({
			contents: [
				{
					parts: [
						{ text: EXTRACTION_PROMPT },
						{
							inline_data: {
								mime_type: mimeType,
								data: imageBase64
							}
						}
					]
				}
			],
			generationConfig: {
				responseMimeType: 'application/json'
			}
		})
	});

	if (!response.ok) {
		const detail = await response.text();
		return json({ error: 'Receipt parsing failed.', detail }, { status: 502 });
	}

	const completion = await response.json();
	const parts = completion.candidates?.[0]?.content?.parts;
	const raw = Array.isArray(parts)
		? parts.map((/** @type {{ text?: string }} */ part) => part.text || '').join('')
		: '';

	if (!raw) {
		return json({ error: 'Empty response from receipt parser.' }, { status: 502 });
	}

	let parsed;
	try {
		parsed = parseJsonFromModelText(raw);
	} catch {
		return json({ error: 'Could not parse AI response as JSON.', raw }, { status: 502 });
	}

	const items = Array.isArray(parsed.items)
		? parsed.items.map((/** @type {Record<string, unknown>} */ item) => ({
				name: String(item.name || 'Item'),
				quantity: Number(item.quantity) || 1,
				unitPrice: Number(item.unitPrice) || 0,
				lineTotal:
					typeof item.lineTotal === 'number'
						? item.lineTotal
						: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0)
			}))
		: [];

	return json({
		currency: parsed.currency || 'EUR',
		items,
		subtotal: parsed.subtotal ?? null,
		tax: parsed.tax ?? null,
		tip: parsed.tip ?? null,
		total: parsed.total ?? null
	});
}
