<script>
	import '../app.css';
	import PwaUpdate from '$lib/PwaUpdate.svelte';

	let { children } = $props();
</script>

<div class="app-shell">
	{@render children()}
	<PwaUpdate />
</div>

<style>
	.app-shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}
</style>
