"""Send one plain-text email with the SMTP settings in the grid data's .env (SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASSWORD, SMTP_FROM, NOTIFY_EMAIL). Subject in argv[2], body on stdin; the .env path in argv[1]."""
import smtplib
import sys
from email.message import EmailMessage

env = {}
for line in open( sys.argv[ 1 ], encoding = 'utf-8' ):
	if '=' in line and not line.lstrip().startswith( '#' ):
		key, value = line.split( '=', 1 )
		env[ key.strip() ] = value.strip().strip( '"' )
if not env.get( 'SMTP_HOST' ) or not env.get( 'NOTIFY_EMAIL' ):
	sys.exit( 'no SMTP settings' )
message = EmailMessage()
message[ 'Subject' ] = sys.argv[ 2 ]
message[ 'From' ] = env.get( 'SMTP_FROM' ) or env[ 'SMTP_USER' ]
message[ 'To' ] = env[ 'NOTIFY_EMAIL' ]
message.set_content( sys.stdin.read() )
with smtplib.SMTP( env[ 'SMTP_HOST' ], int( env.get( 'SMTP_PORT', '587' ) ), timeout = 20 ) as smtp:
	smtp.starttls()
	# App passwords are often copied with (non-breaking) spaces; Gmail ignores them.
	smtp.login( env[ 'SMTP_USER' ], env[ 'SMTP_PASSWORD' ].replace( '\xa0', '' ).replace( ' ', '' ) )
	smtp.send_message( message )
