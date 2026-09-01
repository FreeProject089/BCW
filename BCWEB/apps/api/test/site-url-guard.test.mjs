// SITE_URL, checked at boot, because getting it wrong is silent.
//
// It is read 57 times across 38 modules, each with its own `||` fallback, and they disagree:
// `http://localhost:5176` in mail/sanctions/sweeper/auth/blog, `http://localhost` in
// oidc/status-notify/bot, `https://bettercommunity.ch` in the mail samples, `''` in
// attention/errorlog.
//
// A production deploy that forgets it does not fail. It sends verification e-mails linking to
// `http://localhost:5176`, publishes an OpenID discovery document whose issuer is
// `http://localhost` — unusable by every client — and works perfectly for the one person
// testing from the machine it runs on.
//
// The 57 fallbacks are not the bug and are not rewritten here. Once the boot refuses a bad
// value they are unreachable in production, which is the property this file pins.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { productionSiteUrlProblem, formatSiteUrlProblem, isProduction } from '../src/lib/boot-guard.mjs';

describe('productionSiteUrlProblem', () => {
  test('a real https address is accepted', () => {
    for (const v of ['https://bettercommunity.ch', 'https://bettercommunity.app/', 'https://sub.example.com:8443']) {
      assert.equal(productionSiteUrlProblem({ SITE_URL: v }), null, v);
    }
  });

  test('unset is caught — the deploy forgot it', () => {
    for (const env of [{}, { SITE_URL: '' }, { SITE_URL: '   ' }]) {
      assert.equal(productionSiteUrlProblem(env)?.reason, 'unset');
    }
  });

  test('every way of naming this machine is caught, as a WARNING not a stop', () => {
    // Localhost is flagged but NOT fatal: the bundled compose is the production artifact and
    // also what people run locally, where localhost is correct and is the shipped default —
    // a fatal here would brick every out-of-the-box `docker compose up`. server.mjs logs it
    // and boots; unset and non-https (below) are the hard stops.
    const local = [
      'http://localhost:5176', 'https://localhost', 'http://127.0.0.1:3000',
      'http://0.0.0.0:5176', 'https://LOCALHOST:5176', 'http://myhost.local',
    ];
    for (const v of local) {
      const p = productionSiteUrlProblem({ SITE_URL: v });
      assert.equal(p?.reason, 'localhost', v);
      assert.equal(p?.severity, 'warning', v);
    }
  });

  test('plain http is caught, because cookies read this value', () => {
    // lib.mjs: COOKIE_SECURE = /^https:/i.test(SITE_URL). An http SITE_URL therefore turns
    // Secure off for every session cookie on the site, silently.
    const p = productionSiteUrlProblem({ SITE_URL: 'http://bettercommunity.ch' });
    assert.equal(p?.reason, 'not_https');
    assert.match(p.consequence, /Secure/);
  });

  test('something that is not a URL is caught before it is used', () => {
    assert.equal(productionSiteUrlProblem({ SITE_URL: 'bettercommunity.ch' })?.reason, 'unparseable');
  });

  test('the message names the variable and what it costs', () => {
    // Read at 2am by somebody whose deploy just refused to start. It has to say which
    // variable, what is wrong with it, and why that matters.
    for (const v of ['', 'http://localhost:5176', 'http://example.com', 'nonsense']) {
      const msg = formatSiteUrlProblem(productionSiteUrlProblem({ SITE_URL: v }));
      assert.match(msg, /SITE_URL/);
      assert.ok(msg.includes('otherwise'), msg);
    }
  });
});

describe('when the guard runs', () => {
  test('only on a production boot', () => {
    // A guard that blocks `node server.mjs` on a laptop is a guard somebody removes.
    assert.equal(isProduction({ NODE_ENV: 'production' }), true);
    for (const env of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }, { NODE_ENV: 'staging' }]) {
      assert.equal(isProduction(env), false);
    }
  });
});

describe('the deployed compose file sets it', () => {
  test('SITE_URL is passed to the api service', async () => {
    // The check above is worthless if the supported deployment does not supply the variable:
    // every `docker compose up` in production would refuse to start.
    const { readFileSync } = await import('node:fs');
    const yml = readFileSync(new URL('../../../infra/compose/docker-compose.yml', import.meta.url), 'utf8');
    assert.match(yml, /SITE_URL/, 'docker-compose.yml never mentions SITE_URL');
  });
});
