export function makeWebHost(){ return {
  _editModalOpen:false, freezeBoard(){}, unfreezeBoard(){}, closePopup(){}, consumePendingReload(){},
  attachDatePicker(){}, isSubmitKey(){ return false; }, dateTrigger:'@', timeTrigger:'@@',
  plugin:{ settings:{ editorTools:{ date:false, time:false } } } }; }
