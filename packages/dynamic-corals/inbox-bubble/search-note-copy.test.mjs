import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { readyState: 'loading', addEventListener() {} };
const { COPY } = await import('./inbox-bubble.js');

test('zh-TW search note names the send button generically (there is no 『問』 button)', () => {
	assert.equal(COPY['zh-tw'].searchNote, '打字時只在你的瀏覽器裡找，按下按鈕才會送出。');
	assert.equal(COPY['zh-tw'].searchNote.includes('『問』'), false);
});
