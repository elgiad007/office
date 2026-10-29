#!/bin/sh
set -eu
office_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v php >/dev/null 2>&1 || { echo 'PHP 8.2+ is required.' >&2; exit 1; }
php -r 'if (PHP_VERSION_ID < 80200 || !extension_loaded("pdo_sqlite")) {fwrite(STDERR,"PHP 8.2+ with PDO SQLite is required.\n"); exit(1);}'
echo 'Open the displayed localhost address. Read data/setup-token.txt after the first visit.'
exec php -S "127.0.0.1:${OFFICE_PORT:-8765}" -t "$office_root/public"
