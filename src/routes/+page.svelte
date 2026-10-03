<svelte:options runes={true} />

<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { createId } from '$lib/split/id';
	import {
		computeEqualSplit,
		computeManualSplit,
		itemLineTotal,
		unassignedItemCount
	} from '$lib/split/calc';
	import { clearSession, loadSession, saveSession } from '$lib/split/storage';

	const steps = [
		{ id: 'people', label: 'Crew', emoji: '👥' },
		{ id: 'receipt', label: 'Scan', emoji: '📸' },
		{ id: 'items', label: 'Items', emoji: '🧾' },
		{ id: 'split', label: 'Split', emoji: '✂️' }
	];

	const avatarTones = [
		'linear-gradient(135deg, #6366f1, #8b5cf6)',
		'linear-gradient(135deg, #ec4899, #f472b6)',
		'linear-gradient(135deg, #14b8a6, #22d3ee)',
		'linear-gradient(135deg, #f59e0b, #fbbf24)',
		'linear-gradient(135deg, #3b82f6, #6366f1)'
	];

	let step = $state(0);
	let sessionReady = $state(false);

	/** @type {{ id: string; name: string }[]} */
	let people = $state([]);

	let newPersonName = $state('');

	/** @type {'equal' | 'manual'} */
	let splitMode = $state('equal');

	let currency = $state('EUR');
	let tax = $state(0);
	let tip = $state(0);

	/** @type {{ id: string; name: string; quantity: number; unitPrice: number; lineTotal: number; assignedPersonIds: string[] }[]} */
	let items = $state([]);

	let receiptPreview = $state('');
	let extracting = $state(false);
	/** @type {'reading' | 'uploading'} */
	let extractPhase = $state('reading');
	let extractError = $state('');
	let extractNotice = $state('');
	let showResetConfirm = $state(false);

	/** @param {number} amount */
	function money(amount) {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount || 0);
	}

	const subtotal = $derived(items.reduce((sum, item) => sum + itemLineTotal(item), 0));
	const grandTotal = $derived(subtotal + (Number(tax) || 0) + (Number(tip) || 0));

	const totals = $derived(
		splitMode === 'equal'
			? computeEqualSplit(people, items, Number(tax) || 0, Number(tip) || 0)
			: computeManualSplit(people, items, Number(tax) || 0, Number(tip) || 0)
	);

	const missingAssignments = $derived(
		splitMode === 'manual' ? unassignedItemCount(items) : 0
	);
	const progress = $derived(((step + 1) / steps.length) * 100);

	const canAdvance = $derived(
		step === 0
			? people.length >= 1
			: step === 1
				? items.length > 0
				: step === 2
					? items.length > 0
					: true
	);

	$effect(() => {
		if (!browser || !sessionReady) return;

		saveSession({
			step,
			people,
			items,
			splitMode,
			currency,
			tax,
			tip,
			receiptPreview
		});
	});

	onMount(() => {
		const saved = loadSession();
		if (saved) {
			step = saved.step ?? 0;
			people = saved.people ?? [];
			items = saved.items ?? [];
			splitMode = saved.splitMode ?? 'equal';
			currency = saved.currency ?? 'EUR';
			tax = saved.tax ?? 0;
			tip = saved.tip ?? 0;
			receiptPreview = saved.receiptPreview ?? '';
		}
		sessionReady = true;
	});

	/** @param {number} index */
	function avatarStyle(index) {
		return avatarTones[index % avatarTones.length];
	}

	/** @param {string} name */
	function initials(name) {
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');
	}

	function addPerson() {
		const name = newPersonName.trim();
		if (!name) return;
		people = [...people, { id: createId(), name }];
		newPersonName = '';
	}

	/** @param {string} id */
	function removePerson(id) {
		people = people.filter((p) => p.id !== id);
		items = items.map((item) => ({
			...item,
			assignedPersonIds: item.assignedPersonIds.filter((pid) => pid !== id)
		}));
	}

	function addItem() {
		items = [
			...items,
			{
				id: createId(),
				name: 'New item',
				quantity: 1,
				unitPrice: 0,
				lineTotal: 0,
				assignedPersonIds: people[0] ? [people[0].id] : []
			}
		];
	}

	/** @param {string} id */
	function removeItem(id) {
		items = items.filter((item) => item.id !== id);
	}

	/** @param {{ quantity: number; unitPrice: number; lineTotal: number }} item */
	function syncLineTotal(item) {
		item.lineTotal = item.quantity * item.unitPrice;
	}

	/** @param {string} itemId @param {string} personId */
	function toggleAssign(itemId, personId) {
		items = items.map((item) => {
			if (item.id !== itemId) return item;
			const has = item.assignedPersonIds.includes(personId);
			const assignedPersonIds = has
				? item.assignedPersonIds.filter((id) => id !== personId)
				: [...item.assignedPersonIds, personId];
			return { ...item, assignedPersonIds };
		});
	}

	/** @param {string} personId */
	function assignAllTo(personId) {
		items = items.map((item) => ({ ...item, assignedPersonIds: [personId] }));
	}

	/** @param {File} file */
	function readFileAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
			reader.readAsDataURL(file);
		});
	}

	/** @param {Event & { currentTarget: HTMLInputElement }} event */
	async function onReceiptSelected(event) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		if (!file) return;

		extractError = '';
		extractNotice = '';
		extractPhase = 'reading';
		extracting = true;

		try {
			const dataUrl = await readFileAsDataUrl(file);
			receiptPreview = dataUrl;

			const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
			if (!match) {
				extractError = 'Could not read image data.';
				return;
			}

			extractPhase = 'uploading';

			const res = await fetch('/api/receipt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mimeType: match[1], image: match[2] })
			});
			const data = await res.json();

			if (!res.ok) {
				extractError = data.error || 'Could not read receipt.';
				if (data.detail) {
					try {
						const detail = JSON.parse(data.detail);
						if (detail?.error?.message) extractError = detail.error.message;
					} catch {
						extractError += ` ${String(data.detail).slice(0, 200)}`;
					}
				}
				return;
			}

			if (data.mock && data.message) extractNotice = data.message;

			currency = data.currency || currency;
			if (data.tax != null) tax = data.tax;
			if (data.tip != null) tip = data.tip;

			items = (data.items || []).map(
				(/** @type {{ name: string; quantity: number; unitPrice: number; lineTotal: number }} */ item) => ({
					id: createId(),
					name: item.name,
					quantity: item.quantity,
					unitPrice: item.unitPrice,
					lineTotal: item.lineTotal,
					assignedPersonIds: people[0] ? [people[0].id] : []
				})
			);

			step = 2;
		} catch {
			extractError = 'Network error while parsing receipt.';
		} finally {
			extracting = false;
			extractPhase = 'reading';
			input.value = '';
		}
	}

	function resetApp() {
		clearSession();
		step = 0;
		people = [];
		items = [];
		splitMode = 'equal';
		currency = 'EUR';
		tax = 0;
		tip = 0;
		receiptPreview = '';
		extractError = '';
		extractNotice = '';
		newPersonName = '';
		showResetConfirm = false;
	}
</script>

<svelte:head>
	<title>Halvsies</title>
	<meta
		name="description"
		content="Snap a receipt, split the bill fairly. Halvsies makes group payments painless."
	/>
</svelte:head>

<div class="page">
	<header class="top">
		<div class="brand">
			<span class="logo" aria-hidden="true">½</span>
			<div>
				<h1>Halvsies</h1>
				<p class="tagline">Split receipts, skip the math.</p>
			</div>
		</div>
		<button type="button" class="icon-btn" aria-label="Start over" onclick={() => (showResetConfirm = true)}>
			↺
		</button>
	</header>

	<div class="progress-track" aria-hidden="true">
		<div class="progress-fill" style="width: {progress}%"></div>
	</div>

	<nav class="stepper" aria-label="Steps">
		{#each steps as s, index}
			<button
				type="button"
				class="step-pill"
				class:active={step === index}
				class:done={step > index}
				disabled={index > step}
				onclick={() => {
					if (index <= step) step = index;
				}}
			>
				<span class="emoji">{s.emoji}</span>
				<span class="label">{s.label}</span>
			</button>
		{/each}
	</nav>

	<main class="content">
		{#if step === 0}
			<section class="card">
				<h2>Who&apos;s in?</h2>
				<p class="lede">Add everyone sharing the bill. You need at least one name to continue.</p>

				<form class="add-row" onsubmit={(e) => { e.preventDefault(); addPerson(); }}>
					<input
						bind:value={newPersonName}
						placeholder="Name"
						aria-label="Person name"
						autocomplete="name"
					/>
					<button type="submit" class="btn primary">Add</button>
				</form>

				{#if people.length === 0}
					<p class="empty">No one yet — add your crew above.</p>
				{:else}
					<ul class="people">
						{#each people as person, index (person.id)}
							<li>
								<span class="avatar" style="background: {avatarStyle(index)}">{initials(person.name)}</span>
								<span class="name">{person.name}</span>
								<button type="button" class="text-btn" onclick={() => removePerson(person.id)}>Remove</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		{#if step === 1}
			<section class="card">
				<h2>Snap the receipt</h2>
				<p class="lede">Take a photo or pick one from your gallery. We read line items with Gemini.</p>

				<label class="scan-zone">
					<input
						type="file"
						accept="image/*"
						capture="environment"
						onchange={onReceiptSelected}
						disabled={extracting}
					/>
					<span class="scan-inner">
						<span class="scan-icon">📷</span>
						<strong>Tap to scan</strong>
						<small>Best results: flat, well-lit photo</small>
					</span>
				</label>

				{#if receiptPreview}
					<img class="preview" src={receiptPreview} alt="Receipt preview" />
				{/if}

				{#if extractError}
					<p class="banner error">{extractError}</p>
				{/if}
				{#if extractNotice}
					<p class="banner notice">{extractNotice}</p>
				{/if}

				{#if items.length}
					<p class="hint">Items loaded — jump to <button type="button" class="linkish" onclick={() => (step = 2)}>Items</button> or scan again.</p>
				{/if}
			</section>
		{/if}

		{#if step === 2}
			<section class="card">
				<h2>Check the items</h2>
				<p class="lede">Tweak anything the AI missed before you split.</p>

				<div class="meta-row">
					<label>
						<span>Currency</span>
						<input bind:value={currency} maxlength="3" class="compact" />
					</label>
					<label>
						<span>Tax</span>
						<input type="number" step="0.01" min="0" bind:value={tax} class="compact" />
					</label>
					<label>
						<span>Tip</span>
						<input type="number" step="0.01" min="0" bind:value={tip} class="compact" />
					</label>
				</div>

				<ul class="item-cards">
					{#each items as item (item.id)}
						<li class="item-card">
							<input class="item-name" bind:value={item.name} aria-label="Item name" />
							<div class="item-grid">
								<label>
									<span>Qty</span>
									<input
										type="number"
										min="0"
										step="1"
										bind:value={item.quantity}
										oninput={() => syncLineTotal(item)}
									/>
								</label>
								<label>
									<span>Price</span>
									<input
										type="number"
										min="0"
										step="0.01"
										bind:value={item.unitPrice}
										oninput={() => syncLineTotal(item)}
									/>
								</label>
								<div class="line-total">
									<span>Line</span>
									<strong>{money(itemLineTotal(item))}</strong>
								</div>
							</div>
							<button type="button" class="text-btn danger" onclick={() => removeItem(item.id)}>Delete</button>
						</li>
					{/each}
				</ul>

				<button type="button" class="btn secondary full" onclick={addItem}>+ Add item</button>

				<div class="totals-strip">
					<div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
					<div><span>Total</span><strong>{money(grandTotal)}</strong></div>
				</div>
			</section>
		{/if}

		{#if step === 3}
			<section class="card">
				<h2>Split it</h2>
				<p class="lede">Equal shares or assign dishes to the right people.</p>

				<div class="segmented" role="radiogroup" aria-label="Split mode">
					<button
						type="button"
						class:active={splitMode === 'equal'}
						role="radio"
						aria-checked={splitMode === 'equal'}
						onclick={() => (splitMode = 'equal')}
					>
						Equal
					</button>
					<button
						type="button"
						class:active={splitMode === 'manual'}
						role="radio"
						aria-checked={splitMode === 'manual'}
						onclick={() => (splitMode = 'manual')}
					>
						By item
					</button>
				</div>

				{#if splitMode === 'manual'}
					{#if missingAssignments}
						<p class="banner error">{missingAssignments} item(s) still unassigned.</p>
					{/if}

					<div class="quick-row">
						<span>Assign all to</span>
						<div class="chip-row">
							{#each people as person, index (person.id)}
								<button
									type="button"
									class="chip person-chip"
									style="--person-tone: {avatarStyle(index)}"
									onclick={() => assignAllTo(person.id)}
								>
									<span class="chip-avatar" style="background: {avatarStyle(index)}"
										>{initials(person.name)}</span
									>
									<span class="chip-label">{person.name}</span>
								</button>
							{/each}
						</div>
					</div>

					<ul class="assign-list">
						{#each items as item (item.id)}
							<li>
								<div class="assign-head">
									<strong>{item.name}</strong>
									<span>{money(itemLineTotal(item))}</span>
								</div>
								<div class="chip-row">
									{#each people as person, index (person.id)}
										<button
											type="button"
											class="chip person-chip"
											class:selected={item.assignedPersonIds.includes(person.id)}
											style="--person-tone: {avatarStyle(index)}"
											aria-pressed={item.assignedPersonIds.includes(person.id)}
											onclick={() => toggleAssign(item.id, person.id)}
										>
											<span class="chip-avatar" style="background: {avatarStyle(index)}"
												>{initials(person.name) || '?'}</span
											>
											<span class="chip-label">{person.name}</span>
										</button>
									{/each}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="hint center">
						{people.length} people × {money(grandTotal)} = <strong>{money(grandTotal / (people.length || 1))}</strong> each
					</p>
				{/if}

				<h3 class="result-title">Who owes what</h3>
				<ul class="result-cards">
					{#each totals as row, index (row.personId)}
						<li>
							<span class="avatar sm" style="background: {avatarStyle(index)}">{initials(row.name)}</span>
							<span class="name">{row.name}</span>
							<strong>{money(row.amount)}</strong>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</main>

	<footer class="dock">
		<button type="button" class="btn ghost" disabled={step === 0} onclick={() => step--}>Back</button>
		<span class="step-label">{steps[step].label}</span>
		<button
			type="button"
			class="btn primary"
			disabled={!canAdvance || step >= steps.length - 1}
			onclick={() => step++}
		>
			Next
		</button>
	</footer>
</div>

{#if extracting}
	<div class="loading-screen" aria-busy="true" aria-live="polite">
		<div class="loading-panel">
			{#if receiptPreview}
				<img class="loading-preview" src={receiptPreview} alt="" />
			{/if}
			<div class="loading-card">
				<div class="spinner" aria-hidden="true"></div>
				<h2>Working on your receipt</h2>
				<p>
					{extractPhase === 'reading'
						? 'Preparing your photo…'
						: 'Uploading & reading line items…'}
				</p>
				<p class="loading-sub">This usually takes a few seconds.</p>
			</div>
		</div>
	</div>
{/if}

{#if showResetConfirm}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-backdrop" role="presentation" onclick={() => (showResetConfirm = false)}>
		<div
			class="modal"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			aria-labelledby="reset-title"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 id="reset-title">Start fresh?</h2>
			<p>This clears people, items, and your saved session on this device.</p>
			<div class="modal-actions">
				<button type="button" class="btn ghost" onclick={() => (showResetConfirm = false)}>Cancel</button>
				<button type="button" class="btn danger" onclick={resetApp}>Clear everything</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.page {
		flex: 1;
		display: flex;
		flex-direction: column;
		max-width: 28rem;
		margin: 0 auto;
		width: 100%;
		padding: calc(0.75rem + var(--safe-top)) 1rem calc(5.5rem + var(--safe-bottom));
	}

	.top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.brand {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.logo {
		width: 3rem;
		height: 3rem;
		border-radius: 1rem;
		display: grid;
		place-items: center;
		font-size: 1.5rem;
		font-weight: 800;
		color: white;
		background: linear-gradient(135deg, var(--indigo-600), var(--violet-500));
		box-shadow: var(--shadow-btn);
	}

	h1 {
		font-size: 1.5rem;
		line-height: 1.1;
	}

	.tagline {
		font-size: 0.85rem;
		color: var(--slate-700);
		margin-top: 0.15rem;
	}

	.icon-btn {
		width: 2.75rem;
		height: 2.75rem;
		border: none;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.65);
		font-size: 1.25rem;
		cursor: pointer;
		box-shadow: 0 4px 14px rgba(79, 70, 229, 0.12);
	}

	.progress-track {
		height: 6px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.55);
		overflow: hidden;
		margin-bottom: 0.75rem;
	}

	.progress-fill {
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--indigo-600), var(--pink-400));
		transition: width 0.25s ease;
	}

	.stepper {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		padding-bottom: 0.25rem;
		margin-bottom: 1rem;
		scrollbar-width: none;
	}

	.stepper::-webkit-scrollbar {
		display: none;
	}

	.step-pill {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		border: 2px solid transparent;
		background: rgba(255, 255, 255, 0.55);
		font-weight: 700;
		font-size: 0.8rem;
		color: var(--slate-700);
		cursor: pointer;
	}

	.step-pill.active {
		border-color: var(--indigo-600);
		background: white;
		color: var(--indigo-700);
		box-shadow: var(--shadow-card);
	}

	.step-pill.done:not(.active) {
		opacity: 0.85;
	}

	.step-pill .emoji {
		font-size: 1rem;
	}

	.content {
		flex: 1;
	}

	.card {
		background: rgba(255, 255, 255, 0.92);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		box-shadow: var(--shadow-card);
	}

	.card h2 {
		font-size: 1.35rem;
		margin-bottom: 0.35rem;
	}

	.lede {
		color: var(--slate-500);
		font-size: 0.95rem;
		margin-bottom: 1rem;
	}

	.add-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.btn {
		border: none;
		border-radius: 999px;
		padding: 0.75rem 1.25rem;
		font-weight: 800;
		font-family: var(--font-display);
		cursor: pointer;
		min-height: 48px;
	}

	.btn.primary {
		background: linear-gradient(135deg, var(--indigo-600), var(--violet-500));
		color: white;
		box-shadow: var(--shadow-btn);
	}

	.btn.secondary {
		background: var(--indigo-50);
		color: var(--indigo-700);
	}

	.btn.ghost {
		background: transparent;
		color: var(--indigo-700);
		box-shadow: none;
	}

	.btn.danger {
		background: var(--danger);
		color: white;
	}

	.btn.full {
		width: 100%;
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.empty {
		text-align: center;
		padding: 1.5rem 0.5rem;
		color: var(--slate-500);
		font-weight: 600;
	}

	.people {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.people li {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.65rem 0.75rem;
		background: var(--indigo-50);
		border-radius: var(--radius-md);
	}

	.avatar {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
		display: grid;
		place-items: center;
		color: white;
		font-weight: 800;
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.avatar.sm {
		width: 2rem;
		height: 2rem;
		font-size: 0.7rem;
	}

	.name {
		flex: 1;
		font-weight: 700;
	}

	.text-btn {
		border: none;
		background: none;
		color: var(--indigo-600);
		font-weight: 700;
		cursor: pointer;
		padding: 0.25rem;
	}

	.text-btn.danger {
		color: var(--danger);
		align-self: flex-start;
	}

	.scan-zone {
		display: block;
		margin-bottom: 1rem;
	}

	.scan-zone input {
		display: none;
	}

	.scan-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 1.75rem 1rem;
		border: 2px dashed var(--indigo-500);
		border-radius: var(--radius-lg);
		background: var(--indigo-50);
		cursor: pointer;
		text-align: center;
	}

	.scan-icon {
		font-size: 2rem;
	}

	.preview {
		width: 100%;
		border-radius: var(--radius-md);
		margin-bottom: 0.75rem;
	}

	.banner {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-sm);
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}

	.banner.error {
		background: #ffe4e6;
		color: #9f1239;
	}

	.banner.notice {
		background: #ecfdf5;
		color: #047857;
	}

	.hint {
		font-size: 0.9rem;
		color: var(--slate-500);
	}

	.hint.center {
		text-align: center;
		padding: 0.5rem 0 1rem;
	}

	.linkish {
		border: none;
		background: none;
		color: var(--indigo-600);
		font-weight: 800;
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
	}

	.meta-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.meta-row label span {
		display: block;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--slate-500);
		margin-bottom: 0.25rem;
	}

	.compact {
		min-height: 44px;
		padding: 0.5rem;
		text-align: center;
	}

	.item-cards {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.item-card {
		background: var(--indigo-50);
		border-radius: var(--radius-md);
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.item-name {
		font-weight: 700;
		border: none;
		background: white;
	}

	.item-grid {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.5rem;
		align-items: end;
	}

	.item-grid label span,
	.line-total span {
		display: block;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--slate-500);
		margin-bottom: 0.2rem;
	}

	.item-grid input {
		min-height: 44px;
		padding: 0.5rem;
	}

	.line-total strong {
		display: block;
		font-size: 1rem;
		padding: 0.65rem 0;
	}

	.totals-strip {
		display: flex;
		justify-content: space-between;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 2px dashed var(--indigo-100);
		font-family: var(--font-display);
	}

	.totals-strip span {
		display: block;
		font-size: 0.75rem;
		color: var(--slate-500);
	}

	.segmented {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 0.25rem;
		background: var(--indigo-50);
		border-radius: 999px;
	}

	.segmented button {
		border: none;
		border-radius: 999px;
		padding: 0.65rem;
		font-weight: 800;
		background: transparent;
		color: var(--slate-500);
		cursor: pointer;
	}

	.segmented button.active {
		background: white;
		color: var(--indigo-700);
		box-shadow: 0 4px 12px rgba(79, 70, 229, 0.15);
	}

	.quick-row {
		margin-bottom: 1rem;
	}

	.quick-row > span {
		display: block;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--slate-500);
		margin-bottom: 0.35rem;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		border: 2px solid var(--indigo-100);
		background: white;
		border-radius: 999px;
		padding: 0.4rem 0.75rem;
		font-weight: 700;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.person-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 2px solid transparent;
		background:
			linear-gradient(var(--white), var(--white)) padding-box,
			var(--person-tone) border-box;
		color: var(--slate-700);
		padding: 0.3rem 0.65rem 0.3rem 0.3rem;
	}

	.person-chip.selected {
		background: var(--person-tone);
		border-color: transparent;
		color: var(--white);
		box-shadow: 0 4px 14px rgba(79, 70, 229, 0.22);
	}

	.chip-avatar {
		width: 1.65rem;
		height: 1.65rem;
		border-radius: 999px;
		display: grid;
		place-items: center;
		font-size: 0.62rem;
		font-weight: 800;
		color: var(--white);
		flex-shrink: 0;
	}

	.person-chip.selected .chip-avatar {
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55);
	}

	.chip-label {
		max-width: 6.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.assign-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.assign-head {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.35rem;
		gap: 0.5rem;
	}

	.result-title {
		margin: 1.25rem 0 0.75rem;
		font-size: 1.1rem;
	}

	.result-cards {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.result-cards li {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.75rem;
		background: linear-gradient(135deg, var(--indigo-50), #fdf4ff);
		border-radius: var(--radius-md);
	}

	.result-cards strong {
		margin-left: auto;
		font-size: 1.1rem;
		font-family: var(--font-display);
		color: var(--indigo-700);
	}

	.dock {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		max-width: 28rem;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem calc(0.75rem + var(--safe-bottom));
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(12px);
		border-top: 1px solid rgba(99, 102, 241, 0.15);
	}

	.step-label {
		font-weight: 800;
		font-family: var(--font-display);
		color: var(--indigo-700);
		font-size: 0.85rem;
		text-align: center;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.45);
		display: grid;
		place-items: center;
		padding: 1rem;
		z-index: 50;
	}

	.modal {
		background: white;
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		max-width: 22rem;
		width: 100%;
		box-shadow: var(--shadow-card);
	}

	.modal h2 {
		font-size: 1.2rem;
		margin-bottom: 0.5rem;
	}

	.modal p {
		color: var(--slate-500);
		margin-bottom: 1rem;
	}

	.modal-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.loading-screen {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: 1.25rem;
		background: rgba(15, 23, 42, 0.55);
		backdrop-filter: blur(8px);
	}

	.loading-panel {
		width: min(100%, 22rem);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.loading-preview {
		width: 100%;
		max-height: 9rem;
		object-fit: cover;
		border-radius: var(--radius-md);
		opacity: 0.85;
		box-shadow: var(--shadow-card);
	}

	.loading-card {
		background: white;
		border-radius: var(--radius-lg);
		padding: 1.5rem 1.25rem;
		text-align: center;
		box-shadow: var(--shadow-card);
	}

	.loading-card h2 {
		font-size: 1.2rem;
		margin: 1rem 0 0.35rem;
		color: var(--indigo-700);
	}

	.loading-card p {
		color: var(--slate-500);
		font-weight: 600;
		font-size: 0.95rem;
	}

	.loading-sub {
		margin-top: 0.35rem;
		font-size: 0.8rem !important;
		font-weight: 500 !important;
		opacity: 0.85;
	}

	.spinner {
		width: 3rem;
		height: 3rem;
		margin: 0 auto;
		border-radius: 50%;
		border: 4px solid var(--indigo-100);
		border-top-color: var(--indigo-600);
		animation: spin 0.85s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
