// Leaving edit mode with an unsaved draft asks, in a small dialog: Save / Keep editing / Discard.
// (Closing the tab keeps the browser's own beforeunload prompt.) Pure: what to do, never the DOM.
//
// "Edit mode" is the row of tiles and the wall — the two screens where tiles change. Moving between
// them is not leaving; going to a view a visitor gets (stack, list) is.
export const LEAVE_CHOICES = ['save', 'keep', 'discard'];

/** 'ask' when the step leaves edit mode with something unsaved, else 'go' */
export function leaveStep({ dirty, editing, toEditing }) {
  if (!editing || toEditing) return 'go';
  return dirty ? 'ask' : 'go';
}

/**
 * The person's answer → what happens: { save, leave, md }. `md` is the draft afterwards: Discard puts
 * back what was saved; Save and Keep editing leave the draft as it is.
 */
export function resolveLeave(choice, { md, savedMd }) {
  if (choice === 'save') return { save: true, leave: true, md };
  if (choice === 'discard') return { save: false, leave: true, md: savedMd };
  return { save: false, leave: false, md };
}
