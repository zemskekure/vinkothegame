export const api = ( path, opts = {} ) => fetch( path, { ...opts, headers: { 'content-type': 'application/json', ...opts.headers } } ).then( async r => {

	const data = await r.json();
	if ( ! r.ok ) throw new Error( data.error || r.statusText );
	return data;

} );

export const esc = s => String( s ?? '' ).replace( /[&<>"]/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );

export const STATUS = { todo: 'k udělání', in_progress: 'rozpracováno', done: 'hotovo', needs_fix: 'k opravě' };

export const STATE = {
	queued: 've frontě', running: 'běží', building: 'sestavuje', review: 'ke kontrole', merged: 'sloučeno',
	rejected: 'zahozeno', failed: 'selhalo', cancelled: 'zrušeno', conflict: 'konflikt', empty: 'beze změn', imported: 'přepis'
};

export function tokens( n ) {

	if ( ! n ) return '0';
	if ( n >= 1e9 ) return ( n / 1e9 ).toFixed( 2 ) + ' G';
	if ( n >= 1e6 ) return ( n / 1e6 ).toFixed( n >= 1e8 ? 0 : 1 ) + ' M';
	if ( n >= 1e3 ) return Math.round( n / 1e3 ) + ' k';
	return String( n );

}

export const usd = n => '$' + ( n >= 100 ? n.toFixed( 0 ) : n >= 10 ? n.toFixed( 1 ) : n.toFixed( 2 ) );
export const pct = n => n == null ? '—' : ( n >= 10 ? n.toFixed( 0 ) : n.toFixed( 1 ) ) + ' %';

export const when = iso => iso ? new Date( iso ).toLocaleString( 'cs', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' } ) : '';

export const firstLine = s => ( s || '' ).split( '\n' ).map( l => l.trim() ).find( Boolean ) || '';
