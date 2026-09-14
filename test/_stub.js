// Apps Script 런타임 스텁 — 테스트에서 Code.js를 로드하기 위한 최소 구현
const fs = require('fs'), vm = require('vm'), path = require('path');

const OFF = { // tz -> 실효 UTC 오프셋(분)
  'Asia/Seoul': 540, 'America/Los_Angeles': -420, 'UTC': 0,
  'Asia/Kolkata': 330, 'Pacific/Kiritimati': 840
};
const pad = (n, l = 2) => String(n).padStart(l, '0');

function loadCode(sheetTz = 'Asia/Seoul') {
  const Utilities = {
    formatDate(date, tz, fmt) {
      const off = OFF[tz];
      if (off === undefined) throw new Error('unknown tz ' + tz);
      const s = new Date(date.getTime() + off * 60000); // UTC 필드로 읽으면 tz 로컬시각
      if (fmt === 'Z') return (off < 0 ? '-' : '+') + pad(Math.floor(Math.abs(off) / 60)) + pad(Math.abs(off) % 60);
      if (fmt === 'yyyy-MM-dd') return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
      if (fmt === 'yyyy-MM-dd HH:mm') return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
      if (fmt === 'u') return String(s.getUTCDay() === 0 ? 7 : s.getUTCDay());
      throw new Error('unhandled fmt ' + fmt);
    },
    getUuid: () => 'stubuuid'
  };
  const ctx = {
    Utilities,
    Logger: { log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => sheetTz }) },
    LockService: {}, PropertiesService: {}, DriveApp: {}, Session: {}, console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8'), ctx);
  return ctx;
}

function runner() {
  let pass = 0, fail = 0;
  return {
    check(desc, got, want) {
      const ok = got === want; ok ? pass++ : fail++;
      console.log(`${ok ? '✅' : '❌'} ${desc}  →  ${got}${ok ? '' : `  (기대 ${want})`}`);
    },
    done() {
      console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
      process.exit(fail > 0 ? 1 : 0);
    }
  };
}

module.exports = { loadCode, runner, pad, OFF };

/**
 * Common.html의 <script> 블록을 최소 DOM 스텁 위에서 로드한다.
 * 예산/전월대비 같은 순수 로직을 브라우저 없이 검증하기 위한 용도.
 */
function loadCommon(opts = {}) {
  const els = opts.elements || {};
  const mkEl = (id) => ({
    id, value: els[id] !== undefined ? els[id] : '',
    innerText: '', innerHTML: '', style: {}, className: '',
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
  });
  const cache = {};
  const doc = {
    getElementById: (id) => (cache[id] || (cache[id] = mkEl(id))),
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener() {}
  };
  const ctx = {
    document: doc,
    window: { addEventListener() {} },
    console,
    Set, Object, Array, Math, Number, String, Date, JSON, isNaN, parseInt, parseFloat
  };
  ctx.window.document = doc;
  vm.createContext(ctx);

  const html = fs.readFileSync(path.join(__dirname, '..', 'Common.html'), 'utf8');
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  vm.runInContext(js, ctx);
  return ctx;
}

/**
 * vm 컨텍스트 안에서 코드를 실행한다.
 * Common.html의 상태는 let/const 로 선언돼 있어 전역 객체의 프로퍼티가 아니다.
 * 따라서 ctx.rawData = ... 식의 외부 대입은 코드에 보이지 않으므로 이 헬퍼를 쓴다.
 */
function evalIn(ctx, code) {
  return vm.runInContext(code, ctx);
}

/** let 으로 선언된 상태 변수에 값을 주입한다 */
function setState(ctx, obj) {
  ctx.__inject = obj;
  evalIn(ctx, Object.keys(obj).map(k => `${k} = globalThis.__inject["${k}"];`).join('\n'));
}

module.exports.loadCommon = loadCommon;
module.exports.evalIn = evalIn;
module.exports.setState = setState;
