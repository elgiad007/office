// Generated from frontend/mail-rules.ts by pnpm build. Do not edit.
const fields = {
    sender: 'Sender address', domain: 'Sender domain', recipient: 'To header', subject: 'Subject', body: 'Body',
    date: 'Receipt date', time: 'Receipt time',
};
export async function renderMailRules(container, { request, accounts, escape: e, notice }) {
    if (!accounts.length) {
        container.innerHTML = '<h2>Mail Rules</h2><p>Connect a mail account to set up routing rules.</p>';
        return;
    }
    const options = (entries, value) => entries.map(([id, label]) => `<option value="${e(id)}" ${id === value ? 'selected' : ''}>${e(label)}</option>`).join('');
    const accountOptions = accounts.map(a => [a.id, a.label]);
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let settings;
    let busy = false;
    const run = async (action) => {
        if (busy)
            return;
        busy = true;
        container.setAttribute('aria-busy', 'true');
        const controls = [...container.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled)')];
        controls.forEach(control => control.disabled = true);
        try {
            await action();
        }
        catch (error) {
            notice(error instanceof Error ? error.message : String(error), true);
        }
        finally {
            busy = false;
            controls.forEach(control => control.disabled = false);
            container.removeAttribute('aria-busy');
        }
    };
    const panel = () => container.querySelector('[data-rule-panel]');
    const folders = async (account) => (await request('mail-folders', { account })).folders.filter(folder => !folder.protected);
    const save = async (rules) => {
        settings = await request('mail-rules', { operation: 'save', version: settings.version, rules });
        draw();
        notice('Mail rules saved.');
    };
    const update = (rule) => settings.rules.map(item => item.id === rule.id ? rule : item);
    const draw = () => {
        container.innerHTML = `<h2>Mail Rules</h2>
      <p>Rules move new Inbox mail when Office syncs. Sender and domain blocks run first, then the first matching enabled rule wins.</p>
      <ol class="mail-rule-list">${settings.rules.map((rule, i) => `<li>
        <strong>${e(rule.name)}</strong> · ${e(accounts.find(a => a.id === rule.account)?.label ?? (rule.account ? 'Disconnected account' : 'All accounts'))} · ${rule.enabled ? 'Enabled' : 'Disabled'}
        <div class="actions">
          <button data-rule-action="edit" data-index="${i}" aria-label="Edit ${e(rule.name)}">Edit</button>
          <button data-rule-action="toggle" data-index="${i}" aria-label="${rule.enabled ? 'Disable' : 'Enable'} ${e(rule.name)}">${rule.enabled ? 'Disable' : 'Enable'}</button>
          <button data-rule-action="up" data-index="${i}" aria-label="Move ${e(rule.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-rule-action="down" data-index="${i}" aria-label="Move ${e(rule.name)} down" ${i === settings.rules.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-rule-action="preview" data-index="${i}" aria-label="Preview ${e(rule.name)}">Preview existing mail</button>
        </div></li>`).join('')}</ol>
      <button data-new-rule>New rule</button><button data-reload-rules>Reload rules</button><div data-rule-panel></div>`;
        container.querySelector('[data-reload-rules]').onclick = () => void run(async () => {
            settings = await request('mail-rules');
            draw();
        });
        container.querySelector('[data-new-rule]').onclick = () => edit({
            id: crypto.randomUUID(), name: '', enabled: true, account: accounts[0].id, folder: '', mode: 'all', zone: browserZone,
            conditions: [{ field: 'sender', operator: 'is', value: '' }],
        });
        container.querySelectorAll('[data-rule-action]').forEach(button => button.onclick = () => {
            const i = Number(button.dataset.index), rule = settings.rules[i];
            switch (button.dataset.ruleAction) {
                case 'edit':
                    edit(rule);
                    break;
                case 'preview':
                    review(rule);
                    break;
                case 'toggle':
                    void run(() => save(update({ ...rule, enabled: !rule.enabled })));
                    break;
                default: {
                    const other = i + (button.dataset.ruleAction === 'up' ? -1 : 1);
                    const rules = [...settings.rules];
                    [rules[i], rules[other]] = [rules[other], rules[i]];
                    void run(() => save(rules));
                }
            }
        });
    };
    function edit(rule) {
        const target = panel();
        const existing = settings.rules.some(item => item.id === rule.id);
        target.innerHTML = `<h3>${existing ? 'Edit rule' : 'New rule'}</h3><form data-rule-editor>
      <label>Rule name<input name="name" maxlength="120" required value="${e(rule.name)}"></label>
      <label>Mail account<select name="account" aria-label="Mail account">${options([['', 'All accounts'], ...accountOptions,
            ...(rule.account && !accounts.some(a => a.id === rule.account) ? [[rule.account, 'Disconnected account']] : [])], rule.account)}</select></label>
      <div data-destination></div>
      <label>Match<select name="mode" aria-label="Match">${options([['all', 'All conditions'], ['any', 'Any condition']], rule.mode)}</select></label>
      <label>Receipt time zone<input name="zone" maxlength="100" required value="${e(rule.zone)}"></label>
      <p>Use a time zone name such as America/New_York or UTC. Time conditions repeat each day.</p>
      <div data-conditions></div><button type="button" data-add-condition>Add condition</button>
      <label class="check-label"><input type="checkbox" name="enabled" ${rule.enabled ? 'checked' : ''}> Enabled</label>
      <div class="actions"><button class="primary">Save rule</button><button type="button" data-cancel>Cancel</button>
      ${existing ? '<button type="button" class="danger" data-remove-rule>Delete rule</button>' : ''}</div>
    </form>`;
        const form = target.querySelector('form');
        const account = form.querySelector('[name="account"]');
        const destination = form.querySelector('[data-destination]');
        const conditions = form.querySelector('[data-conditions]');
        const add = form.querySelector('[data-add-condition]');
        let folderRequest = 0;
        const loadFolders = async (value) => {
            const id = account.value, token = ++folderRequest;
            if (!id) {
                destination.innerHTML = `<label>Destination<select name="destinationType" aria-label="Destination">${options([['archive', 'Archive'], ['custom', 'Custom folder or label']], value ? 'custom' : 'archive')}</select></label>
          <label data-custom-name>Exact folder or label name<input name="folder" maxlength="500" value="${e(value)}"></label>
          <p>Custom destinations must have the same full name in each account.</p>`;
                const select = destination.querySelector('select');
                const label = destination.querySelector('[data-custom-name]');
                const input = label.querySelector('input');
                const toggle = () => { label.hidden = select.value === 'archive'; input.required = !label.hidden; };
                select.onchange = toggle;
                toggle();
                return;
            }
            destination.textContent = 'Loading folders…';
            let items = [];
            let warning = '';
            try {
                items = await folders(id);
            }
            catch (error) {
                warning = error instanceof Error ? error.message : String(error);
            }
            if (token !== folderRequest)
                return;
            const choices = [['', 'Archive'], ...items.map(f => [f.id, f.name])];
            if (value && !items.some(folder => folder.id === value))
                choices.push([value, `Unavailable · ${value}`]);
            destination.innerHTML = `<label>Destination<select name="folder" aria-label="Destination">${options(choices, value)}</select></label>${warning ? `<p role="status">${e(warning)}</p>` : ''}`;
        };
        account.onchange = () => void loadFolders('');
        void loadFolders(rule.folder);
        const numberConditions = () => {
            const rows = [...conditions.querySelectorAll('fieldset')];
            rows.forEach((row, index) => {
                row.querySelector('legend').textContent = `Condition ${index + 1}`;
                row.querySelector('button').disabled = rows.length === 1;
            });
            add.disabled = rows.length >= 20;
        };
        const addCondition = (condition) => {
            const row = document.createElement('fieldset');
            row.className = 'mail-rule-condition';
            row.innerHTML = `<legend></legend><label>Field<select name="field" aria-label="Field">${options(Object.entries(fields), condition.field)}</select></label>
        <label>Comparison<select name="operator" aria-label="Comparison"></select></label>
        <label>Value<input name="value" maxlength="500" required></label><button type="button">Remove condition</button>`;
            const field = row.querySelector('[name="field"]');
            const operator = row.querySelector('[name="operator"]');
            const value = row.querySelector('input');
            const configure = (comparison, content) => {
                const temporal = field.value === 'date' || field.value === 'time';
                const exact = field.value === 'sender' || field.value === 'domain';
                const choices = temporal ? [['is', 'Is'], ['before', 'Before'], ['after', 'After']] :
                    exact ? [['is', 'Is']] : [['contains', 'Contains'], ['is', 'Is']];
                operator.innerHTML = options(choices, comparison);
                value.type = temporal ? field.value : field.value === 'sender' ? 'email' : 'text';
                value.value = content;
            };
            configure(condition.operator, condition.value);
            field.onchange = () => configure('', '');
            row.querySelector('button').onclick = () => { row.remove(); numberConditions(); };
            conditions.append(row);
            numberConditions();
        };
        rule.conditions.forEach(addCondition);
        add.onclick = () => addCondition({ field: 'subject', operator: 'contains', value: '' });
        form.querySelector('[data-cancel]').onclick = () => target.replaceChildren();
        const remove = form.querySelector('[data-remove-rule]');
        if (remove)
            remove.onclick = () => {
                remove.textContent = 'Confirm delete';
                remove.onclick = () => void run(() => save(settings.rules.filter(item => item.id !== rule.id)));
            };
        form.onsubmit = event => {
            event.preventDefault();
            const data = new FormData(form);
            if (!data.has('folder')) {
                notice('Wait for the destination folders to load.', true);
                return;
            }
            const edited = { ...rule, name: String(data.get('name')).trim(), account: account.value,
                folder: data.get('destinationType') === 'archive' ? '' : String(data.get('folder')),
                zone: String(data.get('zone')).trim(),
                mode: data.get('mode') === 'any' ? 'any' : 'all', enabled: data.has('enabled'),
                conditions: [...conditions.querySelectorAll('fieldset')].map(row => ({
                    field: row.querySelector('[name="field"]').value,
                    operator: row.querySelector('[name="operator"]').value,
                    value: row.querySelector('input').value,
                })) };
            void run(() => save(existing ? update(edited) : [...settings.rules, edited]));
        };
        form.querySelector('input').focus();
    }
    function review(rule) {
        const target = panel();
        const eligible = accountOptions.filter(([id]) => !rule.account || id === rule.account);
        if (!eligible.length) {
            target.textContent = 'Connect the mail account for this rule to preview matches.';
            return;
        }
        target.innerHTML = `<h3>Preview ${e(rule.name)}</h3><p>Review cached Inbox mail for this rule, up to five matches per page.</p>
      <label>Inbox account<select aria-label="Inbox account">${options(eligible, eligible[0][0])}</select></label>
      <button data-preview>Scan Inbox</button> <button data-close>Close preview</button><div data-results aria-live="polite"></div>`;
        const select = target.querySelector('select');
        const results = target.querySelector('[data-results]');
        const scan = (cursor = null) => void run(async () => {
            const account = select.value;
            const data = { id: rule.id, account, version: settings.version };
            const preview = await request('mail-rule-review', { ...data, operation: 'preview', cursor });
            if (select.value !== account)
                return;
            results.innerHTML = `<p>Destination · ${e(preview.destination)}</p>${preview.matches.length ?
                `<ul>${preview.matches.map(message => `<li>${e(message.title)} · ${e(message.from)}</li>`).join('')}</ul>
        <button class="primary" data-apply>Move ${preview.matches.length} reviewed ${preview.matches.length === 1 ? 'message' : 'messages'}</button>` :
                '<p>No matches in this part of the Inbox.</p>'}
        ${preview.cursor ? '<button data-next>Scan next messages</button>' : ''}
        ${preview.errors.map(error => `<p>${e(error)}</p>`).join('')}`;
            const apply = results.querySelector('[data-apply]');
            if (apply)
                apply.onclick = () => void run(async () => {
                    const result = await request('mail-rule-review', { ...data, operation: 'apply', destinationId: preview.destinationId,
                        messages: preview.matches.map(({ id, revision }) => ({ id, revision })) });
                    apply.remove();
                    const status = document.createElement('p');
                    status.textContent = [`Moved ${result.moved} of ${preview.matches.length} messages.`, ...result.errors].join(' ');
                    results.append(status);
                });
            const next = results.querySelector('[data-next]');
            if (next)
                next.onclick = () => scan(preview.cursor);
        });
        select.onchange = () => results.replaceChildren();
        target.querySelector('[data-preview]').onclick = () => scan();
        target.querySelector('[data-close]').onclick = () => target.replaceChildren();
        select.focus();
    }
    try {
        settings = await request('mail-rules');
        draw();
    }
    catch (error) {
        container.textContent = error instanceof Error ? error.message : String(error);
        const retry = document.createElement('button');
        retry.textContent = 'Retry loading Mail Rules';
        retry.onclick = () => void renderMailRules(container, { request, accounts, escape: e, notice });
        container.append(retry);
    }
}
