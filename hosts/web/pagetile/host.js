// pagetile web host glue. Mirrors hosts/web/tugtile/host.js: a minimal host object so the SHARED editor
// engine (mountEditor/equipEditor) runs unchanged when pagetile edits a page's caption/markdown.
// A page caption never "submits" on Enter (Enter is a newline), and pagetile has no kanban dates,
// so date/time tools are off — identical posture to the marktile / tugtile web hosts.
export function makePageHost(){ return {
  _editModalOpen:false, freezeBoard(){}, unfreezeBoard(){}, closePopup(){}, consumePendingReload(){},
  attachDatePicker(){}, isSubmitKey(){ return false; }, dateTrigger:'@', timeTrigger:'@@',
  plugin:{ settings:{ editorTools:{ date:false, time:false } } } }; }
