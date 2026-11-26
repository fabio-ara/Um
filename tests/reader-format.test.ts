import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBody} from '../src/web/dom.ts';

test('formatação inline do leitor exibe ênfase e não executa HTML',()=>{
 assert.equal(renderBody('**Virtude** e *hábito*.'),'<p dir="auto"><strong>Virtude</strong> e <em>hábito</em>.</p>');
 assert.equal(renderBody('**<img src=x onerror=alert(1)>**'),'<p dir="auto"><strong>&lt;img src=x onerror=alert(1)&gt;</strong></p>');
 assert.equal(renderBody('ἄνθρωπος\r\n\r\nالعربية'),'<p dir="auto">ἄνθρωπος</p><p dir="auto">العربية</p>');
 assert.equal(renderBody('Um asterisco * isolado'),'<p dir="auto">Um asterisco * isolado</p>');
 assert.equal(renderBody('\x60**literal**\x60'),'<p dir="auto"><code>**literal**</code></p>');
});
