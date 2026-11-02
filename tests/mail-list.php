<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
function check_attachment(bool $condition,string $label): void { if (!$condition) throw new RuntimeException($label); }
$plain="Subject: Plain\r\n\r\nFirst line\r\nSecond line";
$mixed="Subject: File\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nFirst line\r\n--x\r\nContent-Type: application/pdf; name=report.pdf\r\nContent-Disposition: attachment; filename=report.pdf\r\n\r\nPRIVATE ATTACHMENT\r\n--x--\r\n";
$inline=str_replace(['application/pdf; name=report.pdf','attachment; filename=report.pdf'],['image/png; name=logo.png',"inline; filename=logo.png\r\nContent-ID: <logo>"],$mixed);
check_attachment(parse_eml($plain)['meta']['hasAttachments']===false,'Plain mail has no attachment');
check_attachment(parse_eml($mixed)['meta']['hasAttachments']===true,'Mixed mail has an attachment');
check_attachment(!str_contains(parse_eml($mixed)['body'],'PRIVATE ATTACHMENT'),'Preview source excludes attachment contents');
check_attachment(parse_eml($inline)['meta']['hasAttachments']===false,'Inline logo is not an attachment');
check_attachment(parse_eml(str_replace('attachment; filename=report.pdf','inline; filename=report.pdf',$mixed))['meta']['hasAttachments']===true,'Inline document remains an attachment');
$nested="Content-Type: multipart/mixed; boundary=outer\r\n\r\n--outer\r\n".$mixed."\r\n--outer--\r\n";
check_attachment(eml_has_attachments($nested)===true,'Nested attachment detected');
check_attachment(eml_has_attachments("Content-Type: multipart/mixed; boundary=missing\r\n\r\nbroken")===null,'Malformed MIME remains unknown');
$row=record_row(['kind'=>'mail','revision'=>1,'body'=>'First line','meta'=>json_encode(['remote'=>true,'rawBase64'=>base64_encode($mixed)])]);
$summary=mail_list_record($row);
check_attachment($summary['meta']['hasAttachments']===true && !isset($summary['meta']['rawBase64']),'Legacy originals expose attachment status without blobs');
check_attachment($summary['body']==='First line','Summary retains body for preview and search');
echo "PASS attachment metadata: plain, mixed, nested, inline, malformed MIME, safe body and legacy summary.\n";
