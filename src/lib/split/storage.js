const STORAGE_KEY = 'halvsies-session-v1';

/** @typedef {{ id: string; name: string }} Person */
/** @typedef {{ id: string; name: string; quantity: number; unitPrice: number; lineTotal: number; assignedPersonIds: string[] }} LineItem */
/**
 * @typedef {{
 *   step: number;
 *   people: Person[];
 *   items: LineItem[];
 *   splitMode: 'equal' | 'manual';
 *   currency: string;
 *   tax: number;
 *   tip: number;
 *   receiptPreview: string;
 * }} SessionState
 */

/** @returns {SessionState | null} */
export function loadSession() {
	if (typeof localStorage === 'undefined') return null;

	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const data = JSON.parse(raw);
		if (!data || typeof data !== 'object') return null;
		return /** @type {SessionState} */ (data);
	} catch {
		return null;
	}
}

/** @param {SessionState} state */
export function saveSession(state) {
	if (typeof localStorage === 'undefined') return;

	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Quota exceeded (large receipt preview) — drop preview and retry once.
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, receiptPreview: '' }));
		} catch {
			// ignore
		}
	}
}

export function clearSession() {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(STORAGE_KEY);
}
