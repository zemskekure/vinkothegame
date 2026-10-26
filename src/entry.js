// Which page: the art direction studio (?studio, src/studio.js), a small still scene of its own, or the city and
// its games (src/main.js). Only the chosen one is loaded. Before the city, the start screen (src/start.js) lets the
// player choose the pigeon or the courier, unless the address already says where to go.
if ( new URLSearchParams( location.search ).has( 'studio' ) ) await import( './studio.js' );
else {

	await ( await import( './start.js' ) ).startScreen();
	// The loading bar at once, while the game's code itself still loads.
	( await import( './loading.js' ) ).show();
	await import( './main.js' );

}
