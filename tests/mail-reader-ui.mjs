export async function openMailMore(page) {
  const more=page.locator('#detail [data-mail-disclosure="more"]');
  if(!await more.evaluate(details=>details.open))await more.locator('summary').click();
}

export async function openMailAttachments(page) {
  const files=page.locator('#detail [data-mail-disclosure="files"]');
  if(!await files.evaluate(details=>details.open))await files.locator('summary').click();
}
