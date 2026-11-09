import {commandRegistry} from './commands.js';
import type {AppName} from './types.js';

type HelpScope = 'workspace'|'apps'|'list'|'sidebar'|'settings'|'mail'|'message'|'mail-reader'|'move'|'reply'|'draft'|'item'|'editable'|'saved'|'deletable'|'fullscreen'|'task'|'sheet'|'checklist';
export interface HelpEntry {shortcut: string; action: string; context: string; options: string; scopes: HelpScope[]}
export interface HelpContext {
  app: AppName;
  heading: string;
  guidance: string;
  pane: 'list'|'content'|'sidebar';
  mobile: boolean;
  item?: {draft: boolean; unsaved: boolean; readOnly: boolean; deletable: boolean; complete: boolean; move: boolean; reply: boolean};
}

export function helpEntries(k: Record<string,string>): HelpEntry[] {
  const rows: HelpEntry[]=[];
  const add=(shortcut: string,action: string,context='Normal mode',options='',...scopes: HelpScope[])=>rows.push({shortcut,action,context,options,scopes});
  add(k.help,'Open keyboard and command help','Normal mode, including Settings','Remappable in Settings.');
  add('g b','Go back to the previous view','Normal mode','Press g then b within 900 ms to retrace app changes and opened items, including links and agenda events.');
  add(k.down+' / '+k.up,'Next / previous item','Normal mode','Scrolls a focused wiki page or read-only mail body. Use arrows or Tab for spreadsheet cells.','list');
  add(k.left+' / '+k.right,'Focus the pane to the left / right','Normal mode','Move between the application sidebar, item list, and selected content.');
  add(k.down+' / '+k.up+'; ArrowDown / ArrowUp','Focus next / previous sidebar entry','Application sidebar','Navigate apps, mail accounts, and visible folders. The Mail folder dropdown uses arrow keys to choose a folder.','sidebar');
  add('Enter / Space','Activate the focused sidebar entry','Application sidebar','Enter opens an app, folder, or the focused account’s Inbox. Space expands or collapses account groups. Use the Mail folders button on narrow screens.','sidebar');
  add(k.left+' / '+k.right,'Focus the pane to the left / right','Settings','Move between the application sidebar, category list, and active settings panel.');
  add(k.down+' / '+k.up+'; ArrowDown / ArrowUp; Home / End','Focus next / previous / first / last category','Settings categories','Enter or Space opens the focused category. Tab moves to controls in the open category.','settings');
  add('ArrowDown / ArrowUp; PageDown / PageUp; Home / End','Scroll down / up, page down / up, or jump to top / bottom','Focused settings panel','Office’s remappable and Ctrl scrolling shortcuts also work when the panel itself has focus.','settings');
  add('Backspace','Go up a folder or return to app selection','Mail sidebar','Opens the nearest selectable parent, then the account’s Inbox. From the Inbox, focuses the Mail app button and leaves the Inbox open.');
  add('ArrowDown / ArrowRight; ArrowUp / ArrowLeft','Next / previous item','Item lists','Down or Right moves to the next item; Up or Left moves to the previous item.','list');
  add('Ctrl+f / Ctrl+b','Page down / up','Focused list or nonediting content','Scrolls the focused pane, including HTML mail. Repeating the key continues scrolling.');
  add('Ctrl+d / Ctrl+u','Half page down / up','Focused list or nonediting content','Uses half the pane height. Editors and typing fields retain their native shortcuts.');
  add(k.pageDown+' / '+k.pageUp,'Half page down / up','Focused list or nonediting content','Vimium-style scrolling; remappable in Settings. Uses half the pane height and supports key repeat.');
  add('ArrowDown / ArrowUp; PageDown / PageUp; Home / End','Scroll message; page down / up; top / bottom','Read-only mail body','Uses the same smooth scrolling in HTML and text. Respects reduced-motion preferences.','mail-reader');
  add('gg / G','First / last item','Normal mode','Keeps focus in the current pane; goes to top / bottom in a focused read-only mail body. Press g twice within 900 ms.');
  add('Tab / Shift+Tab','Enter selected content / return to list','Selected list row / content entry','Enters without editing. Standard controls and spreadsheet cells retain native Tab behavior.');
  add('g 1 … g 8','Switch application','Normal mode','1 Mail; 2 Calendar; 3 Tasks; 4 Contacts; 5 Documents; 6 Wiki; 7 Sheets; 8 Lists. Sequence timeout: 900 ms.','workspace');
  add(k.search,'Search current application',undefined,undefined,'apps');add('n / N','Next / previous item in search results','Normal mode','Keeps focus in the current pane, including mail bodies.');
  add(k.connections||'L','Open selected item connections','Normal mode','Remappable in Settings. Also available as :links or :l; add all for the workspace overview.','saved');
  add(k.fullScreen||'z','Toggle selected item full screen','Normal mode, desktop layout','Remappable in Settings. Escape also exits full screen.','fullscreen');
  add(k.new,'Create an item / compose',undefined,undefined,'apps');
  add(k.edit,'Enter edit mode',undefined,undefined,'editable');
  add(k.select,'Toggle current item selection',undefined,undefined,'item');
  add(k.save,'Save changes',undefined,undefined,'editable');
  add('Ctrl+S / Cmd+S','Save changes','Normal or insert mode, outside dialogs','','editable');
  add('Escape','Leave edit mode; clear selection otherwise','Outside dialogs','Saves existing items. New drafts stay unsaved until Save. In formula input, return focus to selected cell.');
  add(k.delete,'Delete selected mail or current item','Normal mode','Local deletion requires confirmation. Connected mail moves to Trash; mail already in Trash and synced read-only items are protected.','deletable');
  add(k.undoDelete,'Undo last mail deletion','Mail, normal mode','Includes batches; available for 15 minutes in this page.','mail');
  add(k.completeTask||'x','Mark current task complete','Tasks, normal mode','Already completed tasks stay complete. New drafts remain unsaved until Save.','task');
  add(k.addChecklistItem||'o','Focus the add item field','Lists, checklist pane','Enter adds an item and keeps the field focused. Paste multiple lines to add one item per line. Escape returns to the checklist.','checklist');
  add(`${k.down} / ${k.up} / ↑ / ↓ / gg / G`,'Move between checklist rows','Lists, focused checklist row','','checklist');
  add(`${k.completeTask||'x'} / Space`,'Check or uncheck a checklist item','Lists, focused checkbox','','checklist');
  add(`${k.edit} / ${k.delete}`,'Edit or remove a checklist item','Lists, focused checklist row','With the named list focused, edit renames the list and delete removes the list after confirmation.','checklist');
  add(k.archive,'Archive messages','Mail, normal mode','','message');add(k.move,'Quick Move to folder','Mail, normal mode','Selected synchronized messages, or current synchronized message.','move');add(k.reply,'Reply to message','Mail, normal mode','','reply');
  add('Ctrl+Enter','Send current message','Mail, normal or insert mode','Press Enter to confirm or Escape to cancel. Change confirmation in Settings → Mail.','draft');
  add(':','Open command line','Normal mode, including Settings','Enter executes once. Escape dismisses suggestions while keeping command mode and text; with suggestions closed, Escape exits and restores focus.','workspace');
  for(const [name,entry] of Object.entries(commandRegistry)){
    const scopes: HelpScope[]=name==='head'?['message']:name==='unlink'?['saved']:[];
    add(':'+name,entry.action,entry.context,entry.options+('aliases' in entry?' Aliases: '+entry.aliases.map(alias=>':'+alias).join(', ')+'.':''),...scopes);
  }
  add('Arrow keys','Move between cells','Sheets, focused cell','30 rows × 12 columns; item shortcuts still navigate records.','sheet');
  add(k.edit+' / Enter','Edit selected cell','Sheets, normal mode','','sheet');add('Tab / Shift+Tab','Next / previous cell','Sheets, focused cell','','sheet');
  add('/; Ctrl+F / Cmd+F','Focus header search','Message headers');add('n / p','Next / previous header match','Message headers, outside search field');add('Enter / Shift+Enter','Next / previous header match','Message headers search field');
  add(`${k.down} / ${k.up}; ArrowDown / ArrowUp`,'Scroll down / up','Focused message header text');
  add(`${k.pageDown} / ${k.pageUp}; Ctrl+D / Ctrl+U`,'Half page down / up','Focused message header text');
  add('PageDown / PageUp; Ctrl+B','Page down / up','Focused message header text','Ctrl+B goes up one page.');
  add('gg / G; Home / End','Go to top / bottom','Focused message header text');
  add(`${k.left} / ${k.down} / ${k.up} / ${k.right}; Arrow keys`,'Navigate map cards','Connections map',`Left/right continue across row boundaries. In a single horizontal row, ${k.down} moves left and ${k.up} moves right. Focused items stay in view.`);
  add('Enter / Space','Explore or open focused item / select item','Connections map','Enter explores groups and item neighborhoods. When the selected item is already the neighborhood center, Enter opens its content, just like Open item.');
  add(k.search==='/'?'/':`/ / ${k.search}`,'Search connected items','Connections window','Enter or Escape in search returns focus to the map. Typing fields retain their normal keys.');
  add('gg / G; Home / End','First / last map card','Connections map');
  add('Backspace','Go back through connections','Connections window, outside typing fields','Restores the previous map and focus. Without earlier history, moves up to the workspace overview; stays there when already at the top.');
  add('Enter / Space on From card','Return to the view you came from','Connections map','The faded From card and dashed line show your navigation path. Current identifies the neighborhood center independently of selection.');
  add('Active / Archived / All','Choose connection visibility','Connections toolbar','Active is the default. Archive or restore a group, the selected item’s connections, or a single link. Underlying items are unchanged.');
  add('Shift+Arrow keys; + / -','Pan / zoom the map','Connections map','Fit view remains available in the toolbar.');
  add('ArrowDown / ArrowUp','Choose matching folder','Quick Move search');add('Enter','Move to chosen folder','Quick Move');add('Escape','Cancel Quick Move','Quick Move','Cannot dismiss while a move is running.');
  add('Shift+F10 / Menu key','Open item action menu','List or nonediting content');add('ArrowDown / ArrowUp / Home / End','Focus next / previous / first / last action','Item action menu');add('Enter / Space','Run focused action','Item action menu');add('Escape / Tab','Close menu and return focus','Item action menu');
  add('Escape','Close mail disclosure, actions menu or narrow-screen folders','Mail','Returns focus to the relevant toggle.');
  add('Tab / Shift+Tab','Move focus forward / backward','Standard controls','Native buttons and disclosures use Enter / Space. Editors retain browser editing keys.');
  add('Escape','Close help or other dismissible dialog','Dialogs','Help returns focus to its opener.');
  return rows;
}
export function searchHelp(entries: HelpEntry[],query: string): HelpEntry[] {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(({shortcut,action,context,options})=>{
    const text=[shortcut,action,context,options].join(' ').toLocaleLowerCase();
    return terms.every(term=>text.includes(term));
  });
}

export function contextualHelp(entries: HelpEntry[],{app,pane,mobile,item}: HelpContext): HelpEntry[] {
  const scopes=new Set<HelpScope>(['workspace']);
  if(pane==='sidebar')scopes.add('sidebar');
  if(app==='settings')scopes.add('settings');
  else {
    scopes.add('apps');
    if(pane!=='content')scopes.add('list');
    if(app==='mail')scopes.add('mail');
  }
  if(item){
    scopes.add('item');
    if(!mobile)scopes.add('fullscreen');
    if(!item.unsaved)scopes.add('saved');
    if(item.deletable)scopes.add('deletable');
    if(!item.readOnly){
      scopes.add('editable');
      if(app==='tasks'&&!item.complete)scopes.add('task');
      if(app==='sheets')scopes.add('sheet');
      if(app==='lists')scopes.add('checklist');
    }
    if(app==='mail'){
      if(item.draft&&!item.readOnly)scopes.add('draft');
      if(!item.draft){
        scopes.add('message');
        if(item.move)scopes.add('move');
        if(item.reply)scopes.add('reply');
        if(pane==='content')scopes.add('mail-reader');
      }
    }
  }
  return entries.filter(entry=>entry.scopes.some(scope=>scopes.has(scope)));
}

export function openHelp(dialog: HTMLDialogElement,keys: Record<string,string>,context: HelpContext,escape: (value: string)=>string,onClose: ()=>void,onLink: ()=>void,opener=document.activeElement as HTMLElement | null) {
  if(dialog.open)return;
  const entries=helpEntries(keys);
  const relevant=contextualHelp(entries,context);
  const version=document.querySelector<HTMLMetaElement>('meta[name="office-version"]')?.content;
  const itemName=context.app==='lists'?'list':'item';
  let connectionGuide='';
  if(context.app!=='settings'){
    if(!context.item)connectionGuide=`<p>Open ${itemName==='list'?'a list':'an item'} to link it to another Office item.</p>`;
    else if(context.item.unsaved)connectionGuide=`<p>Save this ${itemName} before linking it to another Office item.</p>`;
    else connectionGuide=`<div><button type="button" data-help-link>Link an existing item</button> <kbd>:link</kbd></div>
      <p>Search by name or item type, choose a result, then press Enter to create the link.</p>
      <p>To create a new item with a link back to this ${itemName}, use a command such as <kbd>:new linked task Follow up</kbd>. Office creates the link when you first save the new item.</p>`;
  }
  dialog.classList.add('help-dialog');
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">Keyboard shortcuts and commands</h2><p class="help-version">${version?`Office version ${escape(version)}`:'Office version unavailable'}</p></div><button class="quiet" data-close aria-label="Close help">✕</button></div>
    <div class="help-tabs" role="tablist" aria-label="Help">
      <button type="button" role="tab" id="help-view-tab" aria-selected="true" aria-controls="help-view">This view</button>
      <button type="button" role="tab" id="help-all-tab" aria-selected="false" aria-controls="help-all" tabindex="-1">All help</button>
    </div>
    <section class="help-panel help-context" role="tabpanel" id="help-view" aria-labelledby="help-view-tab" tabindex="0">
      <h3>${escape(context.heading)}</h3><p>${escape(context.guidance)}</p>
      ${connectionGuide?`<section class="help-connections" aria-labelledby="help-connections-title"><h4 id="help-connections-title">Connections</h4>${connectionGuide}</section>`:''}
      <dl>${relevant.map(row=>`<div><dt>${escape(row.action)} <kbd>${escape(row.shortcut)}</kbd></dt><dd>${escape(row.context)}${row.options?' · '+escape(row.options):''}</dd></div>`).join('')}</dl>
    </section>
    <section class="help-panel" role="tabpanel" id="help-all" aria-labelledby="help-all-tab" hidden>
      <div class="help-tools"><p>Normal mode navigates and insert mode types. Single-key actions use your current Settings bindings. Editors retain browser editing keys.</p><label>Search shortcuts and commands <input type="search" data-help-search autocomplete="off"></label><button data-help-clear>Clear search</button><span data-help-count role="status" aria-live="polite"></span></div>
      <div class="help-results" tabindex="0" role="region" aria-label="Shortcut and command results"><table class="help-table" role="table"><thead><tr><th scope="col">Shortcut or command</th><th scope="col">Action</th><th scope="col">Context</th><th scope="col">Options/parameters</th></tr></thead><tbody role="rowgroup"></tbody></table><p data-help-empty hidden>No shortcuts or commands match your search.</p></div>
    </section>`;
  const tabs=[...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels=[...dialog.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  const selectTab=(index: number)=>{
    tabs.forEach((tab,i)=>{
      tab.tabIndex=i===index?0:-1;
      tab.setAttribute('aria-selected',String(i===index));
      panels[i].hidden=i!==index;
    });
    tabs[index].focus({preventScroll:true});
  };
  tabs.forEach((tab,i)=>{
    tab.onclick=()=>selectTab(i);
    tab.onkeydown=event=>{
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      selectTab(event.key==='Home'?0:event.key==='End'?tabs.length-1:1-i);
    };
  });
  const input=dialog.querySelector<HTMLInputElement>('[data-help-search]')!,clear=dialog.querySelector<HTMLButtonElement>('[data-help-clear]')!;
  const render=()=>{
    const matches=searchHelp(entries,input.value);
    dialog.querySelector('tbody')!.innerHTML=matches.map(row=>`<tr role="row"><td role="cell"><kbd>${escape(row.shortcut)}</kbd></td><td role="cell">${escape(row.action)}</td><td role="cell">${escape(row.context)}</td><td role="cell">${escape(row.options)}</td></tr>`).join('');
    dialog.querySelector('[data-help-count]')!.textContent=matches.length+' of '+entries.length+' entries';
    dialog.querySelector<HTMLElement>('[data-help-empty]')!.hidden=!!matches.length;
    clear.disabled=!input.value;
  };
  input.onkeydown=event=>{
    if(event.key!=='Escape'||event.isComposing)return;
    event.preventDefault();
    dialog.close();
  };
  input.oninput=render;clear.onclick=()=>{input.value='';render();input.focus();};dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>dialog.close();
  const restore=()=>{
    dialog.classList.remove('help-dialog');
    onClose();
    if(opener?.isConnected)opener.focus({preventScroll:true});
  };
  dialog.addEventListener('close',restore,{once:true});
  const link=dialog.querySelector<HTMLButtonElement>('[data-help-link]');
  if(link)link.onclick=()=>{
    dialog.removeEventListener('close',restore);
    dialog.close();
    restore();
    onLink();
  };
  render();dialog.showModal();tabs[0].focus();
}
