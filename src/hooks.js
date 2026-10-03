/** @type {import('@sveltejs/kit').Handle} */
export const handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/split' || event.url.pathname === '/split/') {
		return Response.redirect(`${event.url.origin}/`, 308);
	}

	return resolve(event);
};
