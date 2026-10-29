<?php
declare(strict_types=1);

/** Shared by manual save and the guided connection check. Never returns secrets to the browser. */
function validate_account_input(array $input): array {
    $text = static function (string $key, string $default = '') use ($input): string {
        $value = $input[$key] ?? $default;
        if (!is_string($value)) fail('Invalid account field: '.$key.'.');
        return $value;
    };
    $type = $text('type');
    if (!in_array($type, ['imap', 'google', 'caldav'], true)) fail('Unknown connector.');
    $label = trim($text('label'));
    if (!$label || strlen($label) > 200) fail('Enter an account label of up to 200 bytes.');
    $config = [];
    $credentials = [];
    if ($type === 'imap') {
        foreach (['host', 'smtp'] as $field) {
            $config[$field] = trim($text($field));
            if (!preg_match('/^[a-zA-Z0-9.-]{1,253}$/D', $config[$field])) fail('Enter a server hostname without a protocol or port.');
        }
        $config['archiveFolder'] = trim($text('archiveFolder', 'Archive'));
        if (!$config['archiveFolder'] || preg_match('/[\r\n\x00]/', $config['archiveFolder'])) fail('Enter a valid existing archive folder.');
        $config['trashFolder'] = trim($text('trashFolder', 'Trash'));
        if (!$config['trashFolder'] || preg_match('/[\r\n\x00]/', $config['trashFolder'])) fail('Enter a valid existing trash folder.');
    }
    if ($type !== 'caldav') {
        $config['email'] = trim($text('email'));
        if (!filter_var($config['email'], FILTER_VALIDATE_EMAIL)) fail('Enter a valid sender email.');
    }
    if ($type === 'imap' || $type === 'caldav') {
        $credentials = ['username' => $text('username'), 'password' => $text('password')];
        if (!$credentials['username'] || !$credentials['password'] || preg_match('/[\r\n\x00]/', implode('', $credentials))) fail('Enter a valid username and password or app password.');
    }
    if ($type === 'caldav') {
        $config['url'] = trim($text('url'));
        $url = parse_url($config['url']);
        if (!$url || ($url['scheme'] ?? '') !== 'https' || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['fragment']) || !in_array($url['port'] ?? 443, [443,8443], true)) {
            fail('Use an HTTPS calendar collection URL on port 443 or 8443, without embedded credentials.');
        }
    }
    if ($type === 'google') {
        $config['redirect'] = trim($text('redirect'));
        $url = parse_url($config['redirect']);
        if (!$url || !in_array($url['scheme'] ?? '', ['http','https'], true) || empty($url['host']) || (($url['scheme'] ?? '') === 'http' && !in_array($url['host'], ['localhost','127.0.0.1'], true)) || isset($url['user']) || isset($url['pass']) || isset($url['fragment']) || preg_match('/[\r\n\x00]/', $config['redirect'])) {
            fail('Use the exact HTTPS callback URL shown in Office (HTTP is allowed on localhost).');
        }
        $credentials = ['client_id' => trim($text('client_id')), 'client_secret' => trim($text('client_secret'))];
        if (!$credentials['client_id'] || !$credentials['client_secret']) fail('Enter your Google OAuth client ID and client secret.');
    }
    if (strlen(json_encode([$config, $credentials], JSON_THROW_ON_ERROR)) > 16000) fail('Account settings too large.');
    return ['type' => $type, 'label' => $label, 'config' => $config, 'credentials' => $credentials];
}

function check_account_connection(array $account): array {
    if ($account['type'] === 'google') {
        return ['status' => 'authorization_required', 'checks' => [
            ['label' => 'Configuration', 'status' => 'ok', 'message' => 'Required fields and callback format are valid. Google has not verified these credentials yet.'],
            ['label' => 'Google access', 'status' => 'pending', 'message' => 'Save the account, then authorize with Google to verify the client credentials and permissions.'],
        ]];
    }
    $checks = [];
    $probe = static function (string $label, callable $check) use (&$checks): void {
        try {
            $check();
            $checks[] = ['label' => $label, 'status' => 'ok', 'message' => 'Connection and authentication succeeded.'];
        } catch (HttpError $error) {
            $checks[] = ['label' => $label, 'status' => 'error', 'message' => $error->getMessage()];
        } catch (Throwable) {
            $checks[] = ['label' => $label, 'status' => 'error', 'message' => 'Connection check failed. Check the provider settings and server extensions.'];
        }
    };
    if ($account['type'] === 'imap') {
        $probe('IMAP inbox and archive · TLS 993', static function () use ($account): void {
            $socket = socket_connection($account['config']['host'], 993);
            try {
                if (!str_starts_with((string)fgets($socket,65536), '* OK')) fail('Unexpected IMAP greeting.');
                imap_command($socket, 'LOGIN '.imap_quote($account['credentials']['username']).' '.imap_quote($account['credentials']['password']));
                imap_command($socket, 'EXAMINE INBOX');
                imap_archive_folder($socket, $account['config']['archiveFolder']);
            } finally { fclose($socket); }
        });
        $probe('SMTP login · TLS 465', static function () use ($account): void {
            $socket = socket_connection($account['config']['smtp'], 465);
            try {
                smtp_expect($socket, [220]);
                write_all($socket, "EHLO portable-office.local\r\n");
                smtp_expect($socket, [250]);
                write_all($socket, 'AUTH PLAIN '.base64_encode("\0".$account['credentials']['username']."\0".$account['credentials']['password'])."\r\n");
                smtp_expect($socket, [235]);
                // No MAIL FROM, recipient, DATA, or message is submitted by this probe.
            } finally { fclose($socket); }
        });
    } else {
        $probe('CalDAV calendar collection', static function () use ($account): void {
            if (!class_exists('DOMDocument')) fail('The DOM extension is required for CalDAV.');
            $xml = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
            $auth = base64_encode($account['credentials']['username'].':'.$account['credentials']['password']);
            $response = web_request($account['config']['url'], 'PROPFIND', ['Depth: 0', 'Content-Type: application/xml; charset=utf-8', 'Authorization: Basic '.$auth], $xml);
            $document = new DOMDocument();
            $previous = libxml_use_internal_errors(true);
            try {
                if (!$document->loadXML($response['body'], LIBXML_NONET) || $document->doctype) fail('The server did not return valid CalDAV properties.');
            } finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
            $xpath = new DOMXPath($document);
            $xpath->registerNamespace('d', 'DAV:');
            $xpath->registerNamespace('c', 'urn:ietf:params:xml:ns:caldav');
            if (!$xpath->query('//d:propstat[contains(d:status," 200 ")]/d:prop/d:resourcetype/c:calendar')->length) fail('This URL is not a readable calendar collection. Use the collection URL supplied by your provider.');
        });
    }
    $ok = !array_filter($checks, static fn(array $check): bool => $check['status'] !== 'ok');
    return ['status' => $ok ? 'ok' : 'failed', 'checks' => $checks];
}
