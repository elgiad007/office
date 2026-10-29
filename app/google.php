<?php
declare(strict_types=1);

function google_settings(): array {
    $saved = setting('google_integration');
    return $saved ? decrypt_secret($saved) : [];
}

function save_google_settings(array $input): void {
    $previous = google_settings();
    foreach (['client_id','client_secret','redirect'] as $key) {
        if (isset($input[$key]) && !is_string($input[$key])) fail('Invalid Google integration field.');
    }
    $id = trim($input['client_id'] ?? '');
    $secret = trim($input['client_secret'] ?? '');
    if (!$secret && $id === ($previous['client_id'] ?? '')) $secret = $previous['client_secret'] ?? '';
    $redirect = trim($input['redirect'] ?? '');
    // Reuse the existing callback and credential validation.
    validate_account_input(['type'=>'google','label'=>'Integration','email'=>'owner@example.com','client_id'=>$id,'client_secret'=>$secret,'redirect'=>$redirect]);
    $url = parse_url($redirect);
    if (!str_ends_with($url['path'] ?? '', '/api.php') || ($url['query'] ?? '') !== 'r=oauth-callback') fail('Use the exact Office callback ending in api.php?r=oauth-callback.');
    set_setting('google_integration', encrypt_secret(['client_id'=>$id,'client_secret'=>$secret,'redirect'=>$redirect]));
}

function start_google_connection(array $input): string {
    if (!empty($input['id'])) {
        $a = account((string)$input['id']);
        if ($a['type'] !== 'google') fail('Not a Google account.');
        $credentials = $a['credentials'];
        $redirect = $a['config']['redirect'];
        $email = $a['config']['email'];
        $calendar = $a['config']['calendar'] ?? true;
        $label = $a['label'];
    } else {
        $credentials = google_settings();
        if (!$credentials) fail('Configure Google integration in Settings once before connecting accounts.');
        $redirect = $credentials['redirect'];
        $email = $input['email'] ?? '';
        if (!is_string($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid Gmail or Google Workspace email address.');
        $label = trim(is_string($input['label'] ?? null) ? $input['label'] : '');
        if (strlen($label) > 200) fail('Account label is too long.');
        $calendar = ($input['calendar'] ?? false) === true;
    }
    $state = bin2hex(random_bytes(24));
    $verifier = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
    $_SESSION['oauth'] = ['account'=>$a['id'] ?? null,'email'=>$email,'label'=>$label,'calendar'=>$calendar,'redirect'=>$redirect,
        'credentials'=>encrypt_secret(['client_id'=>$credentials['client_id'],'client_secret'=>$credentials['client_secret']]),
        'state'=>$state,'verifier'=>$verifier,'time'=>time()];
    return 'https://accounts.google.com/o/oauth2/v2/auth?'.http_build_query([
        'client_id'=>$credentials['client_id'],'redirect_uri'=>$redirect,'response_type'=>'code',
        'scope'=>'https://www.googleapis.com/auth/gmail.modify'.($calendar ? ' https://www.googleapis.com/auth/calendar.readonly' : ''),
        'login_hint'=>$email,'access_type'=>'offline','prompt'=>'consent','state'=>$state,
        'code_challenge'=>rtrim(strtr(base64_encode(hash('sha256',$verifier,true)), '+/', '-_'), '='),'code_challenge_method'=>'S256']);
}

/** Validate the grant and provider identity before changing any saved account. */
function finish_google_connection(array $oauth, array $tokens, array $profile): string {
    $email = $profile['emailAddress'] ?? '';
    if (!is_string($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Google did not confirm a valid Gmail address.');
    if (empty($tokens['access_token']) || empty($tokens['refresh_token'])) fail('No offline authorization received. Connect again and approve access.');
    $scopes = explode(' ', $tokens['scope'] ?? '');
    if (!in_array('https://www.googleapis.com/auth/gmail.modify', $scopes, true)
        || ($oauth['calendar'] && !in_array('https://www.googleapis.com/auth/calendar.readonly', $scopes, true))) fail('Required Google permissions were not approved. Connect again.');
    $db = db(); $db->exec('BEGIN IMMEDIATE');
    try {
        $id = $oauth['account'];
        if ($id) {
            $old = account($id);
            if (strcasecmp($old['config']['email'], $email) !== 0) fail('Choose the original Google account when reconnecting.');
        }
        foreach ($db->query("SELECT id,config FROM accounts WHERE type='google'")->fetchAll() as $row) {
            if ($row['id'] !== $id && strcasecmp(json_decode($row['config'], true)['email'], $email) === 0) fail('This Google account is already connected. Use Authorize on the existing account.',409);
        }
        $credentials = array_merge($tokens, decrypt_secret($oauth['credentials']), ['expires'=>time()+(int)($tokens['expires_in'] ?? 3600)]);
        $config = ['email'=>$email,'redirect'=>$oauth['redirect'],'calendar'=>$oauth['calendar']];
        if ($id) $db->prepare('UPDATE accounts SET config=?,secret=?,error=NULL WHERE id=?')->execute([json_encode($config),encrypt_secret($credentials),$id]);
        else {
            $id = bin2hex(random_bytes(16));
            $db->prepare('INSERT INTO accounts(id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute([$id,$oauth['label'] ?: $email,'google',json_encode($config),encrypt_secret($credentials)]);
        }
        $db->exec('COMMIT'); return $id;
    } catch (Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
}
