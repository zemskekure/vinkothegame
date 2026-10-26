import { existsSync } from 'node:fs';

export default {
	base: './',
	// Whether the owner's private friends folder is there (src/friends.js): without it the game doesn't even ask for it.
	define: { __FRIENDS__: JSON.stringify( existsSync( 'public/models/people/friends/friends.json' ) ) },
	build: {
		target: 'esnext',
		rollupOptions: {
			output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' }
		}
	},
	server: { host: true }
};
