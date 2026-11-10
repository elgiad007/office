<?php
declare(strict_types=1);

/** Shared by manual save and the guided connection check. Never returns secrets to the browser. */
function validate_account_input(array $input): array {
    // A setup preset, stored as an ordinary encrypted IMAP/SMTP account.
    $gmail = ($input['type'] ?? null) === 'gmail';
    if ($gmail) {
        if (!is_string($input['password'] ?? null)) fail('Enter a valid Google app password.');
        $password = str_replace(' ', '', trim($input['password']));
        if (!preg_match('/^[a-zA-Z]{16}$/D', $password)) fail('Enter the 16-letter Google app password, not your normal Google password.');
        $input = array_merge($input, ['type'=>'imap', 'host'=>'imap.gmail.com', 'smtp'=>'smtp.gmail.com',
            'username'=>$input['email'] ?? '', 'password'=>$password, 'archiveFolder'=>'Archive', 'trashFolder'=>'Trash']);
    }
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
        caldav_validate_url($config['url'], 'calendar collection');
    }
    if ($type === 'imap' && imap_calendar_eligible(['type'=>$type,'config'=>$config])) {
        $calendarUrl = trim($text('calendarUrl'));
        if ($calendarUrl !== '') caldav_validate_url($calendarUrl, 'CalDAV server or collection');
        $config['calendarUrl'] = $calendarUrl;
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

function account_edit_version(array $a): string {
    return hash('sha256',json_encode([$a['label'],$a['config'],$a['type']==='google'?'':$a['secret']],JSON_THROW_ON_ERROR));
}

function account_edit_details(array $a): array {
    $fields=match($a['type']) {
        'imap'=>['email','host','smtp','archiveFolder','trashFolder','calendarUrl'],
        'caldav'=>['url'],
        'google'=>['email'],
    };
    return ['id'=>$a['id'],'type'=>$a['type'],'label'=>$a['label'],'version'=>account_edit_version($a),
        'gmailImap'=>$a['type']==='imap' && imap_is_gmail($a),'username'=>$a['credentials']['username']??'']
        +array_intersect_key($a['config'],array_flip($fields));
}

function account_edit_input(array $input,array $saved): array {
    if (($input['version']??null)!==account_edit_version($saved)) fail('Account settings changed. Close and reopen the editor.',409);
    if ($saved['type']==='google') {
        $label=is_string($input['label']??null)?trim($input['label']):'';
        if (!$label || strlen($label)>200) fail('Enter an account label of up to 200 bytes.');
        return array_replace($saved,['label'=>$label]);
    }
    $input['type']=$saved['type'];
    if (($input['password']??'')==='') $input['password']=$saved['credentials']['password'];
    if ($saved['type']==='imap' && imap_is_gmail($saved)) {
        $email=$input['email']??null;
        if (!is_string($email) || strcasecmp(trim($email),$saved['config']['email'])!==0) fail('Connect a new Gmail account to use a different address.');
        $input=array_replace($input,array_intersect_key(account_edit_details($saved),array_flip(['email','host','smtp','username','archiveFolder','trashFolder'])));
        if ($input['password']!==$saved['credentials']['password']) {
            $password=is_string($input['password'])?str_replace(' ','',trim($input['password'])):'';
            if (!preg_match('/^[a-zA-Z]{16}$/D',$password)) fail('Enter the 16-letter Google app password.');
            $input['password']=$password;
        }
    }
    $edited=validate_account_input($input);
    $edited['config']=array_replace($saved['config'],$edited['config']);
    return $edited;
}

function update_account_settings(array $input): array {
    $id=(string)($input['id']??'');
    return with_account_mail_lock('sync:'.$id,fn()=>with_account_mail_lock($id,function()use($id,$input){
        $saved=account($id);
        $edited=account_edit_input($input,$saved);
        if ($saved['type']==='google') {
            db()->prepare('UPDATE accounts SET label=? WHERE id=?')->execute([$edited['label'],$id]);
            return ['id'=>$id];
        }
        $before=$saved['config']; $after=$edited['config'];
        $loginChanged=($saved['credentials']['username']??'')!==($edited['credentials']['username']??'');
        $mailboxChanged=$saved['type']==='imap' && ($loginChanged || strcasecmp($before['host'],$after['host'])!==0);
        $collectionChanged=$saved['type']==='caldav' && ($loginChanged || $before['url']!==$after['url']);
        $calendarServerChanged=$mailboxChanged || ($before['calendarUrl']??'')!==($after['calendarUrl']??'') ||
            ($saved['type']==='imap' && strcasecmp($before['email'],$after['email'])!==0);
        if (($mailboxChanged || $collectionChanged || $calendarServerChanged) && ($input['confirmChange']??false)!==true) {
            $message=$mailboxChanged?'Switch mailboxes and replace this account’s downloaded mail and calendars?'
                :($collectionChanged?'Switch calendar connections and replace this account’s downloaded events?':'Change calendar discovery settings and replace this account’s downloaded calendars?');
            return ['id'=>$id,'confirmation'=>$message];
        }
        $folderChanged=$saved['type']==='imap' && (($before['archiveFolder']??'Archive')!==$after['archiveFolder'] || ($before['trashFolder']??'Trash')!==$after['trashFolder']);
        $credentialsChanged=$edited['credentials']!==$saved['credentials'];
        $defaults=$saved['type']==='imap'?['archiveFolder'=>'Archive','trashFolder'=>'Trash','calendarUrl'=>'']:[];
        $connectionChanged=$credentialsChanged || ($before+$defaults)!=($after+$defaults);
        $db=db(); $db->beginTransaction();
        try {
            $secret=$credentialsChanged?encrypt_secret($edited['credentials']):$saved['secret'];
            $db->prepare('UPDATE accounts SET label=?,config=?,secret=?,last_sync=?,error=? WHERE id=?')->execute([
                $edited['label'],json_encode($after,JSON_THROW_ON_ERROR),$secret,$connectionChanged?null:$saved['last_sync'],$connectionChanged?null:$saved['error'],$id]);
            if ($mailboxChanged || $collectionChanged || $calendarServerChanged) {
                $delete=$db->prepare("DELETE FROM records WHERE kind=? AND json_extract(meta,'$.account')=? AND json_extract(meta,'$.remote')=1");
                if ($mailboxChanged) {
                    $delete->execute(['mail',$id]);
                    mail_undo_prune();
                    $db->prepare("DELETE FROM mail_undo WHERE json_extract(payload,'$.before.meta.account')=?")->execute([$id]);
                }
                if ($collectionChanged || $calendarServerChanged) $delete->execute(['calendar',$id]);
            }
            $clear=$db->prepare('DELETE FROM settings WHERE key=?');
            if ($mailboxChanged || $folderChanged) {
                foreach (['imap-checkpoints','imap-repair','mail-folders','mail-pending'] as $key) $clear->execute([$key.':'.$id]);
            }
            if ($mailboxChanged) $clear->execute(['gmail-spam-grant:'.$id]);
            if ($calendarServerChanged) $clear->execute(['caldav-discovery:'.$id]);
            elseif ($saved['type']==='imap' && $credentialsChanged) {
                $discovery=setting('caldav-discovery:'.$id,[]);
                unset($discovery['checked'],$discovery['synced'],$discovery['error']);
                set_setting('caldav-discovery:'.$id,$discovery);
            }
            $db->commit();
        } catch (Throwable $e) { $db->rollBack(); throw $e; }
        return ['id'=>$id];
    }));
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
        $probe('IMAP inbox, archive and trash · TLS 993', static function () use ($account): void {
            $socket = socket_connection($account['config']['host'], 993);
            try {
                if (!str_starts_with((string)fgets($socket,65536), '* OK')) fail('Unexpected IMAP greeting.');
                imap_command($socket, 'LOGIN '.imap_quote($account['credentials']['username']).' '.imap_quote($account['credentials']['password']));
                imap_command($socket, 'EXAMINE INBOX');
                imap_archive_folder($socket, $account['config']['archiveFolder']);
                $folders = imap_list_folders(imap_command($socket, 'LIST "" "*"'));
                $trash = imap_resolve_folder($folders, $account['config']['trashFolder'], 'trash', true, imap_is_gmail($account));
                imap_command($socket, 'STATUS '.imap_quote($trash).' (MESSAGES)');
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
            $response = web_request($account['config']['url'], 'PROPFIND', ['Depth: 0', 'Content-Type: application/xml; charset=utf-8', 'Authorization: Basic '.$auth], $xml,8388608,true);
            $xpath = caldav_xpath($response['body']);
            if (!$xpath->query('//d:propstat[contains(d:status," 200 ")]/d:prop/d:resourcetype/c:calendar')->length) fail('This URL is not a readable calendar collection. Use the collection URL supplied by your provider.');
        });
    }
    $ok = !array_filter($checks, static fn(array $check): bool => $check['status'] !== 'ok');
    return ['status' => $ok ? 'ok' : 'failed', 'checks' => $checks];
}
