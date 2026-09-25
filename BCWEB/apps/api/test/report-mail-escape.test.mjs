// The report notices put their line into the mail as TEXT.
//
// POST /reports mails the first staff member "A user opened a report on <type> "<targetLabel>"".
// targetLabel is the reporter's own input (any signed-in account, 160 characters) and it was
// interpolated raw into `<p>${line}</p>`, so a report could carry a link or an image of its
// choosing into the inbox of the moderators — the people a phishing link is worth most against.
// (Semgrep raw-html-format / html-in-template-string pointed at the line.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.JWT_SECRET ||= 'report-mail-escape-test-secret';
const { reportMailHtml } = await import('../src/routes/reports.mjs');
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/routes/reports.mjs'), 'utf8');

describe('report notice mails', () => {
  test('a hostile targetLabel arrives as text, not markup', () => {
    const label = '<a href="https://evil.example/login">Review it here</a><img src="https://evil.example/p.gif">';
    // The line exactly as POST /reports builds it.
    const line = `A user opened a report on user "${label}".`;
    const html = reportMailHtml('New report opened', line, { label: 'View the conversation', url: 'https://bettercommunity.ch/dashboard?s=reports&r=1' }, 'report-new');
    assert.doesNotMatch(html, /evil\.example\/login">/, 'the injected link survived as a tag');
    assert.doesNotMatch(html, /<img src="https:\/\/evil/, 'the injected image survived as a tag');
    assert.match(html, /&lt;a href=&quot;https:\/\/evil\.example\/login&quot;&gt;Review it here&lt;\/a&gt;/);
  });

  test('mailReport sends what reportMailHtml builds (the escape is on the path that ships)', () => {
    const body = SRC.match(/async function mailReport\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    assert.ok(body.includes('sendMail('), 'mailReport not found — the check below would be vacuous');
    assert.match(body, /html:\s*reportMailHtml\(/);
    assert.doesNotMatch(body, /mailShell\(/, 'mailReport builds its own HTML again, beside the escaping helper');
  });
});
