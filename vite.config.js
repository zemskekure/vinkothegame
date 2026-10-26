import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Which build this is, shown small on the start screen and in the pause menu: the build's date and the commit
// it was built from ("dev" where git isn't there, e.g. a copied folder).
function version() {

	const day = new Date().toISOString().slice( 0, 10 ).replaceAll( '-', '.' );
	try {

		const hash = execSync( 'git rev-parse --short HEAD', { stdio: [ 'ignore', 'pipe', 'ignore' ] } ).toString().trim();
		return `v${day} · ${hash}`;

	} catch {

		return `v${day} · dev`;

	}

}

export default {
	base: './',
	// The build's version, and whether the owner's private friends folder is there (src/friends.js): without it the
	// game doesn't even ask for it.
	define: { __BUILD__: JSON.stringify( version() ), __FRIENDS__: JSON.stringify( existsSync( 'public/models/people/friends/friends.json' ) ) },
	build: {
		target: 'esnext',
		rollupOptions: {
			output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' }
		}
	},
	server: { host: true }
};
