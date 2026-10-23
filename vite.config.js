export default {
	base: './',
	build: {
		target: 'esnext',
		rollupOptions: {
			output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' }
		}
	},
	server: { host: true }
};
