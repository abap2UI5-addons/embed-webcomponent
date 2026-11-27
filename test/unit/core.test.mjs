/* The core protocol client: requests, delta, slots, transport, actions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, PROTOCOL, PROTOCOLS, httpErrorText, ERROR_TEXT_MAX, followUps } from '../../src/core/session.js';
import { createFetchTransport, isValidContextId } from '../../src/core/transport.js';
import { createActions, isSameOriginUrl } from '../../src/core/actions.js';

const view = (slot, xml = '<mvc:View xmlns:mvc="sap.ui.core.mvc"/>', options) => ['VIEW_SLOTS', 'display', slot, xml, options];
/* a protocol-2 answer (abap2UI5 up to 1.150.0): the S_ACTION envelope */
const answer = (id, { app = 'Z_APP', system = [], custom = [], model } = {}) => {
  const r = { S_FRONT: { ID: id, APP: app, PROTOCOL: 2, S_ACTION: {} } };
  if (system.length) r.S_FRONT.S_ACTION.T_SYSTEM = system;
  if (custom.length) r.S_FRONT.S_ACTION.T_CUSTOM = custom;
  if (model !== undefined) r.MODEL = model;
  return r;
};
/* a protocol-3 answer (abap2UI5 1.151.0 on): VIEWS, NAV, ACTIONS */
const answer3 = (id, { app = 'Z_APP', views, nav, actions, model } = {}) => {
  const r = { S_FRONT: { ID: id, APP: app, PROTOCOL: 3 } };
  if (views) r.S_FRONT.VIEWS = views;
  if (nav) r.S_FRONT.NAV = nav;
  if (actions) r.S_FRONT.ACTIONS = actions;
  if (model !== undefined) r.MODEL = model;
  return r;
};
const XML = '<mvc:View xmlns:mvc="sap.ui.core.mvc"/>';

function scripted(responses) {
  const sent = [];
  return {
    sent,
    roundtrip: async (body) => {
      sent.push(JSON.parse(JSON.stringify(body)));
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'object' && next.status) return next;
      return { ok: true, status: 200, body: JSON.stringify(next) };
    },
  };
}

const session = (t) => new Session({ transport: t, location: (app) => ({ origin: 'http://h', pathname: '/sap/bc/z2ui5/', search: `?app_start=${app}` }), window: { innerWidth: 1280, innerHeight: 800, navigator: { userAgent: '' }, addEventListener() {} } });

test('app start: location, device block, adopted id and slots', async () => {
  const t = scripted([answer('D1', { system: [view('MAIN')], model: { NAME: 'x' } })]);
  const s = session(t);
  const seen = [];
  s.on('response', (r) => seen.push(r));
  await s.start('Z_APP');
  assert.deepEqual(t.sent[0].S_FRONT.SEARCH, '?app_start=Z_APP');
  assert.equal(t.sent[0].S_FRONT.CONFIG.S_DEVICE.SYSTEM, 'desktop');
  assert.equal(t.sent[0].S_FRONT.ID, undefined);
  assert.equal(s.state.id, 'D1');
  assert.deepEqual(seen[0].changed, ['MAIN']);
  assert.equal(s.models.MAIN.data.NAME, 'x');
});

test('an event ships the delta of the edited paths of its slot model', async () => {
  const t = scripted([
    answer('D1', { system: [view('MAIN')], model: { NAME: 'x', T: [{ A: 1 }, { A: 2 }] } }),
    answer('D2'),
  ]);
  const s = session(t);
  await s.start('Z_APP');
  s.models.MAIN.set('/NAME', 'y');
  s.models.MAIN.set('/T/1/A', 5);
  await s.fire('MAIN', 'SAVE', ['arg', 3]);
  assert.deepEqual(t.sent[1], { S_FRONT: { ID: 'D1', EVENT: 'SAVE', T_EVENT_ARG: ['arg', 3] }, MODEL: { NAME: 'y', T: { __delta: { 1: { A: 5 } } } } });
  assert.equal(s.models.MAIN.edited.size, 0, 'sent edits are confirmed');
  assert.equal(s.state.id, 'D2');
  // an event without edits and args carries neither key
  t.sent.length = 1;
});

test('popup model is its own; an APP change tears down popup and popover', async () => {
  const t = scripted([
    answer('D1', { system: [view('MAIN')], model: { A: 1 } }),
    answer('D2', { system: [view('POPUP', '<core:FragmentDefinition xmlns:core="sap.ui.core"/>')], model: { A: 1, P: 'p' } }),
    answer('D3', { app: 'Z_OTHER' }),
  ]);
  const s = session(t);
  await s.start('Z_APP');
  await s.fire('MAIN', 'OPEN');
  assert.ok(s.state.slots.POPUP);
  s.models.POPUP.set('/P', 'edited');
  assert.equal(s.models.MAIN.edited.size, 0);
  await s.fire('POPUP', 'GO');
  assert.deepEqual(t.sent[2].MODEL, { P: 'edited' });
  assert.equal(s.state.slots.POPUP, undefined, 'APP change closes the popup');
});

test('protocol 3: VIEWS in slot order, NAV as the router options, ACTIONS as the follow-up actions', async () => {
  assert.equal(PROTOCOL, 3);
  assert.deepEqual([...PROTOCOLS], [2, 3]);
  const t = scripted([
    answer3('D1', {
      views: { POPUP: { XML: '<core:FragmentDefinition xmlns:core="sap.ui.core"/>' }, MAIN: { XML, OPT: { transition: 'slide' } } },
      nav: { setNavRouting: 'KEEP' },
      actions: [['MESSAGE_TOAST', 'show', 'hi']],
      model: { A: 1 },
    }),
    answer3('D2', { views: { POPUP: { DESTROY: true } } }),
  ]);
  const s = session(t);
  const seen = [];
  s.on('response', (r) => seen.push(r));
  await s.start('Z_APP');
  assert.equal(s.protocol, 3);
  assert.equal(s.state.id, 'D1');
  assert.ok(s.state.slots.MAIN && s.state.slots.POPUP, 'MAIN applied before POPUP, whatever the key order');
  assert.deepEqual(s.state.slots.MAIN.options, { transition: 'slide' });
  assert.deepEqual(s.models.MAIN.data, { A: 1 });
  assert.deepEqual(seen[0].routerOptions, { setNavRouting: 'KEEP' });
  assert.deepEqual(seen[0].custom, [['MESSAGE_TOAST', 'show', 'hi']]);
  await s.fire('MAIN', 'CLOSE');
  assert.equal(s.state.slots.POPUP, undefined, 'a DESTROY entry tears the slot down');
  assert.ok(s.state.slots.MAIN, 'a slot the response does not name stays');
  assert.deepEqual(seen[1].routerOptions, {}, 'no NAV, no options');
});

test('protocol 3: an APP change leaves a slot the response does not name as it is', async () => {
  const t = scripted([
    answer3('D1', { views: { MAIN: { XML }, POPOVER: { XML: '<core:FragmentDefinition xmlns:core="sap.ui.core"/>' } } }),
    answer3('D2', { app: 'Z_OTHER' }),
    answer3('D3', { app: 'Z_THIRD', views: { POPOVER: { DESTROY: true } } }),
  ]);
  const s = session(t);
  await s.start('Z_APP');
  await s.fire('MAIN', 'GO');
  assert.ok(s.state.slots.POPOVER, 'the backend states the teardown - none stated, none done');
  await s.fire('MAIN', 'GO');
  assert.equal(s.state.slots.POPOVER, undefined);
});

test('a START_TIMER tick carries TIMER for a protocol-3 backend only', async () => {
  const t = scripted([answer3('D1', { views: { MAIN: { XML } } }), answer3('D2'), answer('D3'), answer('D4')]);
  const s = session(t);
  await s.start('Z_APP');
  await s.fire('MAIN', 'TICK', [], { timer: true });
  assert.equal(t.sent[1].S_FRONT.TIMER, true);
  await s.fire('MAIN', 'GO');
  assert.equal(t.sent[2].S_FRONT.TIMER, undefined, 'only a tick');
  await s.fire('MAIN', 'TICK', [], { timer: true });
  assert.equal(t.sent[3].S_FRONT.TIMER, undefined, 'the last answer spoke protocol 2');
});

test('closeSlot is local and drops the slot edits', async () => {
  const t = scripted([answer('D1', { system: [view('MAIN'), view('POPOVER', '<x/>', { openById: 'b' })], model: { A: 1 } })]);
  const s = session(t);
  await s.start('Z_APP');
  s.models.POPOVER.set('/A', 2);
  s.closeSlot('POPOVER');
  assert.equal(s.state.slots.POPOVER, undefined);
  assert.equal(s.models.POPOVER.edited.size, 0);
  assert.equal(t.sent.length, 1);
});

test('errors: the body verbatim, the status without one, protocol mismatch, network', async () => {
  const body = 'Request failed in app <b>Z</b> &amp; <img src=x onerror=alert(1)>\nCX_SY_ZERODIVIDE';
  const t = scripted([
    { ok: false, status: 500, body },
    { ok: false, status: 503, body: '  ' },
    answer('X'),
    new Error('offline'),
  ]);
  t.roundtrip = ((orig) => async (b) => {
    const r = await orig(b);
    if (r.body && r.body.includes('"ID":"X"')) return { ok: true, status: 200, body: r.body.replace('"PROTOCOL":2', '"PROTOCOL":99') };
    return r;
  })(t.roundtrip);
  const s = session(t);
  // spec/errors.md: never stripped, decoded or interpreted - the text as it came
  await assert.rejects(s.start('Z'), (e) => e.message === body && e.status === 500 && !e.retry);
  await assert.rejects(s.start('Z'), (e) => e.message === 'HTTP 503' && e.retry);
  assert.equal(httpErrorText(500, 'x'.repeat(ERROR_TEXT_MAX + 5)).length > ERROR_TEXT_MAX, true);
  assert.match(httpErrorText(500, 'x'.repeat(ERROR_TEXT_MAX + 5)), /\(5 more characters\)$/);
  await assert.rejects(s.start('Z'), /Protocol mismatch/);
  await assert.rejects(s.start('Z'), (e) => e.retry && /Network error: offline/.test(e.message));
  assert.equal(s.busy, false);
});

test('busy: a second event is dropped, a queue-last wire is sent afterwards', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const sent = [];
  const t = {
    roundtrip: async (body) => {
      sent.push(body.S_FRONT.EVENT || 'start');
      if (body.S_FRONT.EVENT === 'SLOW') await gate;
      return { ok: true, status: 200, body: JSON.stringify(answer(`D${sent.length}`, sent.length === 1 ? { system: [view('MAIN')], model: {} } : {})) };
    },
  };
  const s = session(t);
  await s.start('Z');
  const slow = s.fire('MAIN', 'SLOW');
  assert.deepEqual(await s.fire('MAIN', 'CLICK'), { dropped: true });
  await s.fire('MAIN', 'TYPE1', [], { queueLast: true });
  await s.fire('MAIN', 'TYPE2', [], { queueLast: true });
  release();
  await slow;
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sent, ['start', 'SLOW', 'TYPE2']);
});

/* a transport whose roundtrip of `slow` waits for release() */
function gated(slow, reply) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const sent = [];
  return {
    sent,
    release: () => release(),
    roundtrip: async (body) => {
      sent.push(JSON.parse(JSON.stringify(body)));
      if (body.S_FRONT.EVENT === slow) await gate;
      const r = reply(sent.length, body);
      if (r && r.status) return r;
      return { ok: true, status: 200, body: JSON.stringify(r) };
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 10));

test('a user event that meets a timer tick waits for it and goes out with the id its response named', async () => {
  // spec/transport.md "A user event that meets a timer tick"
  const t = gated('TICK', (n) => answer3(`D${n}`, n === 1 ? { views: { MAIN: { XML } }, model: {} } : {}));
  const s = session(t);
  await s.start('Z_APP');
  const tick = s.fire('MAIN', 'TICK', [], { noBusy: true, timer: true });
  assert.deepEqual(await s.fire('MAIN', 'CLICK', [{ a: 1 }]), { kept: true });
  assert.deepEqual(await s.fire('MAIN', 'CLICK2'), { dropped: true }, 'only the first is kept');
  assert.deepEqual(t.sent.map((b) => b.S_FRONT.EVENT), [undefined, 'TICK'], 'nothing overlaps the tick');
  t.release();
  await tick;
  await settle();
  assert.deepEqual(t.sent.map((b) => b.S_FRONT.EVENT), [undefined, 'TICK', 'CLICK']);
  assert.equal(t.sent[2].S_FRONT.ID, 'D2', 'the id of the tick\'s response');
  assert.deepEqual(t.sent[2].S_FRONT.T_EVENT_ARG, [{ a: 1 }]);
  assert.equal(t.sent[2].S_FRONT.TIMER, undefined);
});

test('a queue-last event that meets a timer tick is kept once, not also queued', async () => {
  const t = gated('TICK', (n) => answer3(`D${n}`, n === 1 ? { views: { MAIN: { XML } }, model: {} } : {}));
  const s = session(t);
  await s.start('Z_APP');
  const tick = s.fire('MAIN', 'TICK', [], { noBusy: true, timer: true });
  assert.deepEqual(await s.fire('MAIN', 'LIVE', [], { queueLast: true }), { kept: true });
  assert.equal(s.queued, null);
  t.release();
  await tick;
  await settle();
  assert.deepEqual(t.sent.map((b) => b.S_FRONT.EVENT), [undefined, 'TICK', 'LIVE'], 'sent once');
});

test('a second queue-last event during a tick is queued behind the kept one', async () => {
  const t = gated('TICK', (n) => answer3(`D${n}`, n === 1 ? { views: { MAIN: { XML } }, model: {} } : {}));
  const s = session(t);
  await s.start('Z_APP');
  const tick = s.fire('MAIN', 'TICK', [], { noBusy: true, timer: true });
  assert.deepEqual(await s.fire('MAIN', 'LIVE1', [], { queueLast: true }), { kept: true });
  assert.deepEqual(await s.fire('MAIN', 'LIVE2', [], { queueLast: true }), { dropped: true });
  t.release();
  await tick;
  await settle();
  assert.deepEqual(t.sent.map((b) => b.S_FRONT.EVENT), [undefined, 'TICK', 'LIVE1', 'LIVE2']);
});

test('the event a tick kept is dropped with its view: an app switch, an error, a route restore', async () => {
  const other = gated('TICK', (n) => answer3(`D${n}`, n === 1 ? { views: { MAIN: { XML } }, model: {} } : { app: 'Z_OTHER', views: { MAIN: { XML } } }));
  const s1 = session(other);
  await s1.start('Z_APP');
  const tick1 = s1.fire('MAIN', 'TICK', [], { noBusy: true, timer: true });
  await s1.fire('MAIN', 'CLICK');
  other.release();
  await tick1;
  await settle();
  assert.deepEqual(other.sent.map((b) => b.S_FRONT.EVENT), [undefined, 'TICK'], 'another app: dropped');

  const failing = gated('TICK', (n) => (n === 1 ? answer3('D1', { views: { MAIN: { XML } }, model: {} }) : { ok: false, status: 500, body: 'dump' }));
  const s2 = session(failing);
  await s2.start('Z_APP');
  const tick2 = s2.fire('MAIN', 'TICK', [], { noBusy: true, timer: true });
  await s2.fire('MAIN', 'CLICK');
  failing.release();
  await tick2.catch(() => {});
  await settle();
  assert.deepEqual(failing.sent.map((b) => b.S_FRONT.EVENT), [undefined, 'TICK'], 'an error: dropped');

  const popup = gated('TICK', (n) => answer3(`D${n}`, n === 1 ? { views: { MAIN: { XML }, POPUP: { XML } }, model: {} } : { views: { POPUP: { DESTROY: true } } }));
  const s3 = session(popup);
  await s3.start('Z_APP');
  const tick3 = s3.fire('MAIN', 'TICK', [], { noBusy: true, timer: true });
  await s3.fire('POPUP', 'OK');
  popup.release();
  await tick3;
  await settle();
  assert.deepEqual(popup.sent.map((b) => b.S_FRONT.EVENT), [undefined, 'TICK'], 'its popup closed: dropped');
});

test('a view the response displays anew takes the unsent edits of the old one with it', async () => {
  // spec/request.md: MODEL names only the attributes the user edited - an
  // edit of app A, made while a tick was in flight, is no edit of app B
  const t = gated('TICK', (n) => [
    answer3('D1', { app: 'Z_A', views: { MAIN: { XML } }, model: { NAME: 'a' } }),
    answer3('D2', { app: 'Z_B', views: { MAIN: { XML } }, model: { NAME: 'b-own' } }),
    answer3('D3', { app: 'Z_B' }),
  ][n - 1]);
  const s = session(t);
  await s.start('Z_A');
  const tick = s.fire('MAIN', 'TICK', [], { noBusy: true, timer: true });
  s.models.MAIN.set('/NAME', 'typed in A');
  t.release();
  await tick;
  assert.deepEqual(s.models.MAIN.data, { NAME: 'b-own' });
  assert.equal(s.models.MAIN.edited.size, 0);
  await s.fire('MAIN', 'B_EVENT');
  assert.equal(t.sent[2].MODEL, undefined);
});

test('the same view re-displayed in its slot drops the edits made while a noBusy roundtrip or tick was in flight', async () => {
  // intended: the UI5 frontend re-creates the view and its model
  // (core/actions/Slots.js createViewModel), the unsent edits go with it
  for (const flags of [{ noBusy: true }, { noBusy: true, timer: true }]) {
    const t = gated('SLOW', (n) => [
      answer3('D1', { views: { MAIN: { XML } }, model: { NAME: 'a', N: 1 } }),
      answer3('D2', { views: { MAIN: { XML } }, model: { NAME: 'a', N: 2 } }),
      answer3('D3'),
    ][n - 1]);
    const s = session(t);
    await s.start('Z_A');
    const slow = s.fire('MAIN', 'SLOW', [], flags);
    s.models.MAIN.set('/NAME', 'typed');
    t.release();
    await slow;
    await settle();
    assert.deepEqual(s.models.MAIN.data, { NAME: 'a', N: 2 }, JSON.stringify(flags));
    assert.equal(s.models.MAIN.edited.size, 0);
    await s.fire('MAIN', 'GO');
    assert.equal(t.sent[2].S_FRONT.EVENT, 'GO');
    assert.equal(t.sent[2].MODEL, undefined, 'no edit of the old view goes out');
  }
});

test('a model push without a new view keeps the edits it did not carry', async () => {
  const t = gated('TICK', (n) => [
    answer3('D1', { views: { MAIN: { XML } }, model: { NAME: 'a', N: 1 } }),
    answer3('D2', { model: { NAME: 'a', N: 2 } }),
    answer3('D3'),
  ][n - 1]);
  const s = session(t);
  await s.start('Z_A');
  const tick = s.fire('MAIN', 'TICK', [], { noBusy: true, timer: true });
  s.models.MAIN.set('/NAME', 'typed');
  t.release();
  await tick;
  assert.deepEqual(s.models.MAIN.data, { NAME: 'typed', N: 2 });
  await s.fire('MAIN', 'GO');
  assert.deepEqual(t.sent[2].MODEL, { NAME: 'typed' });
});

test('end: an answer still under way is dropped, nothing is sent afterwards', async () => {
  // the element removed or restarted with another app while a roundtrip
  // runs: its answer must not render, run follow-up actions (a REDIRECT, the
  // URL hash) or show an error for an app that is gone
  for (const late of [answer('D2', { system: [view('MAIN')], custom: [['MESSAGE_TOAST', 'show', 'late']] }), new Error('offline')]) {
    let release;
    const gate = new Promise((r) => { release = r; });
    const sent = [];
    const t = {
      roundtrip: async (body) => {
        sent.push(body.S_FRONT.EVENT || 'start');
        if (body.S_FRONT.EVENT === 'SLOW') {
          await gate;
          if (late instanceof Error) throw late;
          return { ok: true, status: 200, body: JSON.stringify(late) };
        }
        return { ok: true, status: 200, body: JSON.stringify(answer('D1', { system: [view('MAIN')], model: {} })) };
      },
      ended: 0,
      endSession() { this.ended += 1; },
    };
    const s = session(t);
    await s.start('Z');
    const seen = [];
    s.on('response', (r) => seen.push(r));
    s.on('error', (e) => seen.push(e));
    const slow = s.fire('MAIN', 'SLOW');
    await s.fire('MAIN', 'TYPE', [], { queueLast: true });
    s.end();
    release();
    assert.equal(await slow, null);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, [], 'no response, no error after the end');
    assert.equal(s.state.id, 'D1');
    assert.equal(s.busy, false);
    assert.equal(await s.fire('MAIN', 'AFTER'), null);
    assert.deepEqual(sent, ['start', 'SLOW'], 'neither the queued wire nor a later one is sent');
    assert.equal(t.ended, 1);
  }
});

test('end: the device model lets go of the window', () => {
  // every boot and restart of the element makes a session; the window's
  // resize listener of an ended one must not stay behind
  const listeners = new Set();
  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    navigator: { userAgent: '' },
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  const s = new Session({ transport: { roundtrip: async () => ({}) }, location: () => ({}), window: win });
  assert.equal(listeners.size, 1);
  s.end();
  assert.equal(listeners.size, 0);
});

test('transport: sap-contextid kept, CSRF handshake re-sends the body once', async () => {
  const calls = [];
  const res = (status, headers = {}, body = '{}') => ({ ok: status < 300, status, headers: new Map(Object.entries(headers)), text: async () => body });
  const script = [res(403, { 'x-csrf-token': 'Required' }), res(200, { 'x-csrf-token': 'T0K' }), res(200, { 'sap-contextid': 'SID1' }), res(200)];
  const tr = createFetchTransport({ endpoint: 'http://h/x', fetchImpl: async (url, init) => { calls.push(init); return script.shift(); } });
  await tr.roundtrip({ S_FRONT: {} });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[1].method, 'HEAD');
  assert.equal(calls[1].headers['X-CSRF-Token'], 'Fetch');
  assert.equal(calls[2].headers['X-CSRF-Token'], 'T0K');
  assert.equal(calls[2].body, calls[0].body);
  assert.equal(calls[0].headers['sap-contextid'], undefined);
  await tr.roundtrip({ S_FRONT: {} });
  assert.equal(calls[3].headers['sap-contextid'], 'SID1');
  assert.equal(calls[3].headers['sap-contextid-accept'], 'header');
  assert.equal(isValidContextId('undefined'), false);
  assert.equal(isValidContextId(''), false);
});

test('transport: a context the answer opens after endSession() is ended too', async () => {
  const calls = [];
  let answer;
  const res = (status, headers = {}) => ({ ok: status < 300, status, headers: new Map(Object.entries(headers)), text: async () => '{}' });
  const tr = createFetchTransport({
    endpoint: 'http://h/x',
    fetchImpl: (url, init) => {
      calls.push(init);
      if (init.method === 'POST') return new Promise((resolve) => { answer = resolve; });
      return Promise.resolve(res(200));
    },
  });
  // the start is under way, no context yet - the element is removed
  const start = tr.roundtrip({ S_FRONT: {} });
  await new Promise((r) => setTimeout(r, 0));
  tr.endSession();
  assert.equal(calls.length, 1);
  // the stateful backend opens a context with the late answer
  answer(res(200, { 'sap-contextid': 'SID9' }));
  await start;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'HEAD');
  assert.equal(calls[1].headers['sap-terminate'], 'session');
  assert.equal(calls[1].headers['sap-contextid'], 'SID9');
  assert.equal(tr.state.contextId, null);
});

test('STOP_TIMER reaches the action dispatcher in its place - the vendored applyResponse keeps it out of custom', async () => {
  // applyResponse folds STOP_TIMER into its timer bookkeeping (mcp-server
  // 53555b0); this frontend does not implement it, and the dispatcher reports it
  const t = scripted([
    answer3('D1', {
      views: { MAIN: { XML } },
      actions: [['MESSAGE_TOAST', 'show', 'a'], ['STOP_TIMER'], 'not json', ['VIEW_SLOTS', 'destroy', 'POPUP'], '["MESSAGE_TOAST","show","b"]'],
    }),
    answer('D2', { custom: [['START_TIMER', 'TICK', '100'], JSON.stringify(['STOP_TIMER'])] }),
  ]);
  const s = session(t);
  const seen = [];
  s.on('response', (r) => seen.push(r));
  await s.start('Z_APP');
  assert.deepEqual(seen[0].custom, [['MESSAGE_TOAST', 'show', 'a'], ['STOP_TIMER'], ['MESSAGE_TOAST', 'show', 'b']]);
  await s.fire('MAIN', 'GO');
  assert.deepEqual(seen[1].custom, [['START_TIMER', 'TICK', '100'], ['STOP_TIMER']]);
  assert.deepEqual(followUps({ S_FRONT: { PROTOCOL: 3 } }, []), [], 'no actions, none');
  const reports = [];
  const a = createActions({ ui: {}, fire() {}, closeSlot() {}, report: (r) => reports.push(r.detail) });
  a.run(['STOP_TIMER']);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /STOP_TIMER/);
});

test('frontend actions: toast template, box, title, URL rules, unsupported reported', () => {
  const ui = { log: [], toast: (t, o) => ui.log.push(['toast', t, o.duration]), box: (ty, t, o) => ui.log.push(['box', ty, t, o.actions]), setTitle: (t) => ui.log.push(['title', t]), openUrl: (u) => ui.log.push(['open', u]), busy() {}, theme() {}, focus() {}, navigate() {}, back() {} };
  const reports = [];
  const fired = [];
  const a = createActions({ ui, fire: (...x) => fired.push(x), closeSlot: (s) => ui.log.push(['close', s]), report: (r) => reports.push(r.detail) });
  a.run(['CONTROL_GLOBAL', 'MESSAGE_TOAST', 'show', '{0} pressed', 'Save', { duration: 1000 }]);
  a.run(['MESSAGE_TOAST', 'show', 'plain']);
  a.run(['MESSAGE_BOX', 'confirm', 'Sure?', { actions: ['YES', 'NO'] }]);
  a.run('["SET_TITLE","T1"]');
  a.run(['CONTROL_GLOBAL', 'VIEW_SLOTS', 'destroy', 'POPUP']);
  a.run(['OPEN_NEW_TAB', 'https://evil.example/']);
  a.run(['URLHELPER', 'REDIRECT', { URL: 'javascript:alert(1)' }]);
  a.run(['CONTROL_BY_ID', 'x', 'to']);
  assert.deepEqual(ui.log, [['toast', 'Save pressed', 1000], ['toast', 'plain', 3000], ['box', 'confirm', 'Sure?', ['YES', 'NO']], ['title', 'T1'], ['close', 'POPUP']]);
  assert.equal(reports.length, 3);
  assert.match(reports[2], /CONTROL_BY_ID/);
  assert.equal(isSameOriginUrl('/x', 'http://h/a'), true);
  assert.equal(isSameOriginUrl('http://o/x', 'http://h/a'), false);
});

test('START_TIMER fires its event once, a new roundtrip cancels it', async () => {
  const fired = [];
  const a = createActions({ ui: {}, fire: (...x) => fired.push(x), closeSlot() {}, report() {} });
  a.run(['START_TIMER', 'TICK', '5', 'X']);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(fired, [['MAIN', 'TICK', [], { noBusy: true, timer: true }]]);
  a.run(['START_TIMER', 'TICK', '5']);
  a.cancelTimers();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fired.length, 1);
});

test('retry re-sends the same body and confirms its edits on success', async () => {
  const t = scripted([
    answer('D1', { system: [view('MAIN')], model: { NAME: 'x' } }),
    new Error('offline'),
    answer('D2', { model: { NAME: 'y' } }),
  ]);
  const s = session(t);
  await s.start('Z_APP');
  s.models.MAIN.set('/NAME', 'y');
  await assert.rejects(s.fire('MAIN', 'SAVE'), (e) => e.retry);
  assert.equal(s.models.MAIN.edited.size, 1, 'the edit is still unconfirmed');
  const res = await s.retry();
  assert.equal(res.S_FRONT.ID, 'D2');
  assert.deepEqual(t.sent[2], t.sent[1], 'the same body');
  assert.equal(s.models.MAIN.edited.size, 0, 'confirmed by the retry');
  assert.equal(s.state.id, 'D2');
  assert.equal(await session(scripted([])).retry(), null, 'nothing to re-send');
});

test('texts: the language bundle, the English fallback, placeholders', async () => {
  const { textsFor, resolveLanguage, defineTexts } = await import('../../src/ui/texts.js');
  assert.equal(textsFor('de-AT')('action.CANCEL'), 'Abbrechen');
  assert.equal(textsFor('fr')('action.CANCEL'), 'Cancel');
  assert.equal(textsFor('en')('diagnostics.many', 3), '3 unsupported items - this frontend renders the portable profile');
  assert.equal(textsFor('de')('no.such.key'), 'no.such.key');
  defineTexts('fr', { 'action.CANCEL': 'Annuler' });
  assert.equal(textsFor('fr-CA')('action.CANCEL'), 'Annuler');
  assert.equal(textsFor('fr')('action.OK'), 'OK', 'the rest falls back to English');
  assert.equal(resolveLanguage('de', { documentElement: { lang: 'fr' } }, { language: 'it' }), 'de');
  assert.equal(resolveLanguage(undefined, { documentElement: { lang: 'fr' } }, { language: 'it' }), 'fr');
  assert.equal(resolveLanguage(undefined, { documentElement: { lang: '' } }, { language: 'it' }), 'it');
});
