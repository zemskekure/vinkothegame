// Which page: the art direction studio (?studio, src/studio.js), a small still scene of its own, or the city and
// its games (src/main.js). Only the chosen one is loaded.
if ( new URLSearchParams( location.search ).has( 'studio' ) ) await import( './studio.js' );
else await import( './main.js' );
