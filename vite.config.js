import { execSync } from 'node:child_process';

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
	define: { __BUILD__: JSON.stringify( version() ) },
	build: {
		target: 'esnext',
		rollupOptions: {
			output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' }
		}
	},
	server: { host: true }
};
