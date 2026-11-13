<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/sender-favicon.php';
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
try {
    if(getenv('OFFICE_REMOTE_SENDER_ICONS')!=='1')fail('Remote sender icons are disabled.',404);
    start_session();owner();office_require_profile_context($_GET['profile']??null);session_write_close();
    if($_SERVER['REQUEST_METHOD']!=='GET')fail('Method not allowed.',405);
    if(isset($_SERVER['HTTP_SEC_FETCH_SITE']) && $_SERVER['HTTP_SEC_FETCH_SITE']!=='same-origin')fail('Same-origin image request required.',403);
    serve_sender_favicon((string)($_GET['domain']??''));
} catch(Throwable $error) {
    http_response_code($error instanceof HttpError ? $error->getCode() : 500);
}
