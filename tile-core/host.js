export function makeWebHost(opts){ return {
  _editModalOpen:false, freezeBoard(){}, unfreezeBoard(){}, closePopup(){}, consumePendingReload(){},
  attachDatePicker(){}, isSubmitKey(){ return false; }, dateTrigger:'@', timeTrigger:'@@',
  // ⌘-click on a link. A bare page can open a URL and nothing else: `[[wiki]]` needs someone who
  // knows where the other documents are, and a browser tab does not. Pass `openLink` to answer that
  // yourself — a host with no opener simply has no door, and the click stays a caret placement.
  openLink: (opts && opts.openLink) || ((link) => {
    if (link.kind === 'url' || link.kind === 'image') window.open(link.target, '_blank', 'noopener');
  }),
  plugin:{ settings:{ editorTools:{ date:false, time:false } } } }; }
