/**
 * @param {{ lineTotal?: number; quantity: number; unitPrice: number }} item
 */
export function itemLineTotal(item) {
	if (typeof item.lineTotal === 'number' && !Number.isNaN(item.lineTotal)) {
		return item.lineTotal;
	}
	return item.quantity * item.unitPrice;
}

/**
 * @param {{ id: string; name: string }[]} people
 * @param {{ lineTotal?: number; quantity: number; unitPrice: number }[]} items
 * @param {number} tax
 * @param {number} tip
 */
export function computeEqualSplit(people, items, tax = 0, tip = 0) {
	const subtotal = items.reduce((sum, item) => sum + itemLineTotal(item), 0);
	const grandTotal = subtotal + tax + tip;
	const perPerson = people.length ? grandTotal / people.length : 0;

	return people.map((person) => ({
		personId: person.id,
		name: person.name,
		amount: perPerson
	}));
}

/**
 * @param {{ id: string; name: string }[]} people
 * @param {{ lineTotal?: number; quantity: number; unitPrice: number; assignedPersonIds?: string[] }[]} items
 * @param {number} tax
 * @param {number} tip
 */
export function computeManualSplit(people, items, tax = 0, tip = 0) {
	const personTotals = new Map(people.map((p) => [p.id, 0]));

	for (const item of items) {
		const total = itemLineTotal(item);
		const assignees = item.assignedPersonIds?.length ? item.assignedPersonIds : [];
		if (!assignees.length) continue;

		const share = total / assignees.length;
		for (const personId of assignees) {
			personTotals.set(personId, (personTotals.get(personId) || 0) + share);
		}
	}

	const assignedSubtotal = people.reduce((sum, p) => sum + (personTotals.get(p.id) || 0), 0);
	const extra = tax + tip;

	return people.map((person) => {
		const base = personTotals.get(person.id) || 0;
		const proportion =
			assignedSubtotal > 0 ? base / assignedSubtotal : people.length ? 1 / people.length : 0;

		return {
			personId: person.id,
			name: person.name,
			amount: base + extra * proportion
		};
	});
}

/**
 * @param {{ lineTotal?: number; quantity: number; unitPrice: number; assignedPersonIds?: string[] }[]} items
 */
export function unassignedItemCount(items) {
	return items.filter((item) => !item.assignedPersonIds?.length).length;
}
