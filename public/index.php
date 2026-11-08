<?php
declare(strict_types=1);
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><meta name="color-scheme" content="light dark"><title>Office</title><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="item-menus.css"><link rel="stylesheet" href="activity.css"><link rel="stylesheet" href="mobile.css"><script type="module" src="app.js"></script></head>
<body><a class="skip" href="#main">Skip to content</a><div id="app"><p class="loading">Loading Office…</p></div><footer id="activity-status" aria-label="Office status"><div id="notice" role="status" aria-live="polite">Ready.</div><span id="mail-send-status" role="status" hidden>Sending message…</span><span id="sync-status" hidden>Automatic sync</span><button type="button" id="view-activity" disabled>View activity</button></footer><dialog id="dialog" aria-labelledby="dialog-title"></dialog><dialog id="activity-dialog" aria-labelledby="activity-title"></dialog></body></html>
