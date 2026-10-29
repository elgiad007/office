<?php
declare(strict_types=1);
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Office · Your personal workspace</title><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="theme.css"><script type="module" src="app.js"></script></head>
<body><a class="skip" href="#main">Skip to content</a><div id="app"><p class="loading">Opening your workspace…</p></div><div id="notice" role="status" aria-live="polite"></div><dialog id="dialog" aria-labelledby="dialog-title"></dialog></body></html>
