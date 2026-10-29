<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/mail-html.php';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
$remote=($_GET['images']??'')==='1';
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:".($remote?' https:':'')."; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox");
try {
    start_session(); owner();
    $record=get_record((string)($_GET['id']??''));
    if ($record['kind']!=='mail' || ($record['meta']['folder']??'')==='Drafts') fail('Select a received email.',400);
    $meta=$record['meta'];
    $raw=isset($meta['rawBase64']) ? base64_decode($meta['rawBase64'],true) : ($meta['raw']??'');
    if (!is_string($raw) || strlen($raw)>1400000) fail('Original email is unavailable.',400);
    $content=eml_html($raw);
    echo safe_mail_html($content['html']?:'<p>This email has no HTML version. Choose Text only.</p>',$content['images'],$remote);
} catch (Throwable $error) {
    http_response_code($error instanceof HttpError ? $error->getCode() : 500);
    echo '<p>'.htmlspecialchars($error instanceof HttpError ? $error->getMessage() : 'Email could not be displayed. Choose Text only.',ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'</p>';
}
