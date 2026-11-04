<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/sender-favicon.php';
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
try {
    start_session();owner();session_write_close();
    if($_SERVER['REQUEST_METHOD']!=='GET')fail('Method not allowed.',405);
    serve_sender_favicon((string)($_GET['domain']??''));
} catch(Throwable $error) {
    http_response_code($error instanceof HttpError ? $error->getCode() : 500);
}
