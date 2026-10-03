<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let show = $state(false);

	onMount(() => {
		if (!browser) return;

		import('virtual:pwa-register').then(({ registerSW }) => {
			registerSW({
				onNeedRefresh() {
					show = true;
				},
				onOfflineReady() {
					// App shell cached; no UI needed unless you want a toast.
				}
			});
		});
	});

	function reload() {
		show = false;
		location.reload();
	}
</script>

{#if show}
	<div class="pwa-toast" role="status" aria-live="polite">
		<p>A new version is ready.</p>
		123
		<button type="button" class="reload" onclick={reload}>Update</button>
		<button type="button" class="dismiss" onclick={() => (show = false)}>Later</button>
	</div>
{/if}

<style>
	.pwa-toast {
		position: fixed;
		left: 1rem;
		right: 1rem;
		bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
		z-index: 90;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.85rem 1rem;
		background: #0f172a;
		color: white;
		border-radius: 16px;
		box-shadow: 0 12px 40px rgba(15, 23, 42, 0.35);
		font-size: 0.9rem;
		max-width: 28rem;
		margin: 0 auto;
	}

	.pwa-toast p {
		flex: 1 1 100%;
		margin: 0;
		font-weight: 600;
	}

	.reload,
	.dismiss {
		border: none;
		border-radius: 999px;
		padding: 0.45rem 0.9rem;
		font-weight: 800;
		cursor: pointer;
		font-family: inherit;
	}

	.reload {
		background: linear-gradient(135deg, #4f46e5, #8b5cf6);
		color: white;
	}

	.dismiss {
		background: rgba(255, 255, 255, 0.12);
		color: white;
	}
</style>
