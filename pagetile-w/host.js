// pagetile web host glue. Mirrors tugtile-w/host.js: a minimal host object so the SHARED editor
// engine (mountEditor/equipEditor) runs unchanged when pagetile edits a page's caption/markdown.
// A page caption never "submits" on Enter (Enter is a newline), and pagetile has no kanban dates,
// so date/time tools are off — identical posture to marktile-w / tugtile-w.
export function makePageHost(){ return {
  _editModalOpen:false, freezeBoard(){}, unfreezeBoard(){}, closePopup(){}, consumePendingReload(){},
  attachDatePicker(){}, isSubmitKey(){ return false; }, dateTrigger:'@', timeTrigger:'@@',
  plugin:{ settings:{ editorTools:{ date:false, time:false } } } }; }
