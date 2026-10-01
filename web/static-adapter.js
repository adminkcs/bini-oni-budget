/**
 * 정적 웹 어댑터 (GitHub Pages).
 * Mobile.html + Common.html을 그대로 쓰고, Apps Script 대신 브라우저가 Sheets API로 직접 읽고 쓴다.
 *  - 권한은 drive.file(사용자가 파일 선택 창에서 고른 가계부 파일 하나) + 이메일뿐이다.
 *    다른 시트·드라이브 파일·백업본에는 접근할 수 없다.
 *  - 로그인은 한 번: 팝업으로 받은 코드를 열쇠 교환소(token-service, 별도 Apps Script)에 보내
 *    1시간 토큰 + 장기 열쇠를 받고, 이후엔 장기 열쇠로 화면 뒤에서 자동 갱신한다.
 *  - 설정은 주소의 #cid=..&ex=..&key=..&app=..&sid=.. 로 한 번 받아 브라우저에 저장한다(저장소 공개라 코드에 넣지 않음).
 *  - 마지막으로 받은 데이터를 저장해 두었다가 다음 접속 때 먼저 그린다.
 *  - 화면의 google.script.run 호출(저장·수정·삭제)을 Sheets API 쓰기로 바꿔 연결한다.
 */
(function () {
  var SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
  var NEED_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var KEY_CFG = 'bob.cfg', KEY_TOKEN = 'bob.token', KEY_RT = 'bob.rt', KEY_SNAPSHOT = 'bob.snapshot', KEY_EMAIL = 'bob.email';
  var SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
  var CFG_KEYS = ['cid', 'ex', 'key', 'app', 'sid'];
  var t = { nav: (performance.timeOrigin || Date.now()) };
  var cfg = null;

  // ---------- 저장소(브라우저) ----------
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 용량 초과 등은 무시 */ } }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function readConfigFromHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get('cid') && h.get('ex')) {
      var next = load(KEY_CFG) || {};
      if (next.cid && next.cid !== h.get('cid')) [KEY_TOKEN, KEY_RT].forEach(drop); // 다른 앱 설정이면 예전 열쇠는 버린다
      CFG_KEYS.forEach(function (k) { if (h.get(k)) next[k] = h.get(k); });
      save(KEY_CFG, next);
      history.replaceState(null, '', location.pathname + location.search); // 주소창에서 설정값을 지운다
    }
    var c = load(KEY_CFG);
    return c && c.cid && c.ex ? c : null;
  }

  // ---------- 상태 표시줄 ----------
  function status(text, action) {
    var el = document.getElementById('web-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'web-status';
      document.body.appendChild(el);
    }
    el.innerHTML = '<span>' + escapeHtml(text) + '</span>' +
      (action ? '<button type="button" id="web-status-btn">' + escapeHtml(action.label) + '</button>' : '');
    if (action) document.getElementById('web-status-btn').onclick = action.onClick;
  }

  function hideStatus() {
    var el = document.getElementById('web-status');
    if (el) el.remove();
  }

  function ago(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    var h = Math.round(m / 60);
    return h < 24 ? h + '시간 전' : Math.round(h / 24) + '일 전';
  }

  // ---------- 외부 스크립트 ----------
  var scripts = {};
  function loadScript(src) {
    if (scripts[src]) return scripts[src];
    scripts[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { installScriptRun(); resolve(); }; // Google 스크립트가 window.google을 덮어써도 연결을 다시 건다
      s.onerror = function () { delete scripts[src]; reject(new Error('Google 스크립트를 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
    return scripts[src];
  }

  // ---------- Google 로그인(토큰) ----------
  function reloginError(msg) {
    drop(KEY_TOKEN);
    return Object.assign(new Error(msg || '로그인이 필요합니다.'), { relogin: true });
  }

  function cachedToken() {
    var tk = load(KEY_TOKEN);
    if (!tk || tk.exp - Date.now() <= 60000) return null;
    if (String(tk.scope || '').split(' ').indexOf(NEED_SCOPE) === -1) return null; // 예전 넓은 권한 토큰은 쓰지 않는다
    return tk.value;
  }

  /** 열쇠 교환소 호출. text/plain으로 보내 브라우저 사전 확인(preflight) 없이 Apps Script로 간다 */
  function exchange(body) {
    return fetch(cfg.ex, { method: 'POST', body: JSON.stringify(body) })
      .then(function (res) { return res.json(); })
      .then(function (j) {
        if (!j || j.error || !j.access_token) {
          var err = new Error(j && j.error === 'not_allowed' ? '허용되지 않은 Google 계정입니다.' : '로그인 처리에 실패했습니다(' + ((j && j.error) || '응답 없음') + ').');
          err.code = j && j.error;
          throw err;
        }
        save(KEY_TOKEN, { value: j.access_token, scope: j.scope, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
        if (j.refresh_token) save(KEY_RT, j.refresh_token);
        if (j.email) save(KEY_EMAIL, j.email);
        return j.access_token;
      });
  }

  /** 처음 한 번: 팝업 로그인 → 코드 → 교환소에서 토큰 + 장기 열쇠 */
  function codeLogin() {
    return loadScript('https://accounts.google.com/gsi/client').then(function () {
      return new Promise(function (resolve, reject) {
        google.accounts.oauth2.initCodeClient({
          client_id: cfg.cid,
          scope: SCOPE,
          ux_mode: 'popup',
          prompt: 'consent', // 장기 열쇠를 확실히 받기 위해 동의 화면을 보여 준다
          callback: function (resp) {
            if (resp.error || !resp.code) { reject(new Error(resp.error_description || resp.error || '로그인이 취소되었습니다.')); return; }
            if (String(resp.scope || '').split(' ').indexOf(NEED_SCOPE) === -1) {
              reject(new Error('가계부 파일 접근 권한을 허용해야 사용할 수 있습니다.')); return;
            }
            exchange({ action: 'code', code: resp.code }).then(resolve, reject);
          },
          error_callback: function (err) { reject(new Error((err && err.message) || '로그인이 취소되었습니다.')); }
        }).requestCode();
      });
    });
  }

  /** 유효한 토큰. 만료됐으면 장기 열쇠로 화면 뒤에서 갱신하고, 그것도 안 되면 interactive일 때만 로그인 창을 띄운다 */
  var refreshing = null;
  function accessToken(interactive) {
    var tk = cachedToken();
    if (tk) return Promise.resolve(tk);
    var rt = load(KEY_RT);
    var silent = rt ? (refreshing = refreshing || exchange({ action: 'refresh', refresh_token: rt })
      .finally(function () { refreshing = null; })) : Promise.reject(reloginError());
    return silent.catch(function (e) {
      if (e.code === 'invalid_grant' || e.code === 'not_allowed') drop(KEY_RT); // 끊긴 열쇠는 버린다
      if (interactive) return codeLogin();
      throw e.relogin ? e : reloginError();
    });
  }

  function api(path, opts, retried) {
    return accessToken(false).then(function (tk) {
      var o = Object.assign({}, opts || {});
      o.headers = Object.assign({ Authorization: 'Bearer ' + tk }, o.body ? { 'Content-Type': 'application/json' } : {});
      return fetch(path, o);
    }).then(function (res) {
      if (res.status === 401 && !retried) { drop(KEY_TOKEN); return api(path, opts, true); } // 토큰만 만료: 한 번 갱신 후 재시도
      if (res.status === 401) throw reloginError();
      if (res.status === 403 || res.status === 404) throw Object.assign(new Error('가계부 파일을 선택해 주세요.'), { needFile: true });
      if (!res.ok) return res.text().then(function (b) { throw new Error('Google 시트 요청 실패(' + res.status + '): ' + b.slice(0, 200)); });
      return res.json();
    });
  }

  /** 입력자 기록용 이메일 (로그인 때 교환소가 알려 준 값) */
  function userEmail() { return Promise.resolve(load(KEY_EMAIL) || 'UNKNOWN'); }

  // ---------- 가계부 파일 선택 (drive.file 권한은 사용자가 고른 파일에만 생긴다) ----------
  function pickFile() {
    if (!cfg.key || !cfg.app) return Promise.reject(new Error('파일 선택 설정(key, app)이 없습니다. 첫 접속 주소를 다시 열어 주세요.'));
    return Promise.all([accessToken(false), loadScript('https://apis.google.com/js/api.js')]).then(function (r) {
      var token = r[0];
      return new Promise(function (resolve, reject) {
        gapi.load('picker', function () {
          // setFileIds로 한 파일만 거르면 목록이 비어 나와서 전체 시트 목록을 보여 준다
          var view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(google.picker.DocsViewMode.LIST);
          new google.picker.PickerBuilder()
            .addView(view)
            .setLocale('ko')
            .setOAuthToken(token)
            .setDeveloperKey(cfg.key)
            .setAppId(cfg.app)
            .setTitle('가계부 파일(우리집가계부)을 선택하세요')
            .setCallback(function (d) {
              if (d.action === google.picker.Action.PICKED && d.docs && d.docs[0]) {
                cfg.sid = d.docs[0].id;
                save(KEY_CFG, cfg);
                resolve(cfg.sid);
              } else if (d.action === google.picker.Action.CANCEL) {
                reject(new Error('가계부 파일을 선택해야 사용할 수 있습니다.'));
              }
            })
            .build().setVisible(true);
        });
      });
    });
  }

  // ---------- Sheets 읽기 ----------
  function fetchSheets() {
    if (!cfg.sid) return Promise.reject(Object.assign(new Error('가계부 파일을 선택해 주세요.'), { needFile: true }));
    var params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
    SheetsData.RANGES.forEach(function (r) { params.append('ranges', r); });
    return api(SHEETS + encodeURIComponent(cfg.sid) + '/values:batchGet?' + params).then(function (json) {
      var byTab = {};
      var names = SheetsData.TABS.concat([SheetsData.REG_TAB]);
      (json.valueRanges || []).forEach(function (vr, i) { byTab[names[i]] = vr.values || []; });
      return SheetsData.toDashboardData(byTab);
    });
  }

  // ---------- Sheets 쓰기 (서버 save/update/deleteTransaction과 같은 결과를 돌려준다) ----------
  var W = window.SheetsWrite;
  function q(sheet, a1) { return encodeURIComponent("'" + sheet + "'!" + a1); }

  function writeSave(entry) {
    var err = W.validate(entry);
    if (err) return Promise.resolve({ ok: false, message: err });
    var id = W.newId();
    var sheet = W.sheetOf(entry.구분);
    return userEmail().then(function (actor) {
      var body = JSON.stringify({ values: [W.newRow(entry, id, actor, new Date())] });
      return api(SHEETS + encodeURIComponent(cfg.sid) + '/values/' + q(sheet, 'A:L') +
                 ':append?valueInputOption=USER_ENTERED', { method: 'POST', body: body });
    }).then(function () { return { ok: true, txn: W.clientTxn(entry, id) }; });
  }

  function findRow(sheet, id) {
    return api(SHEETS + encodeURIComponent(cfg.sid) + '/values/' + q(sheet, 'A:A')).then(function (j) {
      return W.findRows(j.values || [], id);
    });
  }

  function batchUpdate(data) {
    return api(SHEETS + encodeURIComponent(cfg.sid) + '/values:batchUpdate', {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data })
    });
  }

  function writeUpdate(entry) {
    var err = W.validate(entry);
    if (err) return Promise.resolve({ ok: false, message: err });
    if (!entry.일련번호) return Promise.resolve({ ok: false, message: '수정할 거래를 찾을 수 없습니다.' });
    var sheet = W.sheetOf(entry.구분);
    return findRow(sheet, entry.일련번호).then(function (rows) {
      if (rows.length === 0) return { ok: false, message: '거래를 찾지 못했습니다.' };
      if (rows.length >= 2) return { ok: false, message: '일련번호가 중복되었습니다(' + rows.length + '건). 관리자 확인이 필요합니다.' };
      var r = rows[0];
      return batchUpdate([
        { range: "'" + sheet + "'!A" + r + ':H' + r, values: [W.updateRow(entry)] },
        { range: "'" + sheet + "'!K" + r, values: [[W.stamp(new Date())]] }
      ]).then(function () { return { ok: true, txn: W.clientTxn(entry, entry.일련번호) }; });
    });
  }

  function writeDelete(entry) {
    if (!entry || !entry.구분 || !entry.일련번호) return Promise.resolve({ ok: false, message: '삭제할 정보 부족.' });
    var sheet = W.sheetOf(entry.구분);
    return findRow(sheet, entry.일련번호).then(function (rows) {
      if (rows.length === 0) return { ok: false, message: '삭제할 거래를 찾지 못했습니다.' };
      if (rows.length >= 2) return { ok: false, message: '일련번호가 중복되었습니다(' + rows.length + '건). 관리자 확인이 필요합니다.' };
      var r = rows[0];
      // 소프트 삭제: 삭제여부(L)=Y, 수정시각(K)=지금. 실제 행 정리는 서버 purgeDeletedRows가 맡는다
      return batchUpdate([
        { range: "'" + sheet + "'!K" + r + ':L' + r, values: [[W.stamp(new Date()), W.DELETED_FLAG]] }
      ]).then(function () { return { ok: true, removed: { 일련번호: String(entry.일련번호), 구분: entry.구분 } }; });
    });
  }

  var WRITERS = { saveTransaction: writeSave, updateTransaction: writeUpdate, deleteTransaction: writeDelete };

  /** Common.html이 부르는 google.script.run.with…Handler(…).함수(인자) 모양을 그대로 받는다 */
  function installScriptRun() {
    window.google = window.google || {};
    function runner(onOk, onFail) {
      return new Proxy({}, {
        get: function (_, name) {
          if (name === 'withSuccessHandler') return function (f) { return runner(f, onFail); };
          if (name === 'withFailureHandler') return function (f) { return runner(onOk, f); };
          return function (arg) {
            var fn = WRITERS[name];
            if (!fn) return; // logPageLoad 등 Apps Script 전용 호출은 무시
            fn(arg).then(function (res) {
              if (res && res.ok) refreshSnapshotQuietly();
              if (onOk) onOk(res);
            }).catch(function (e) {
              if (e.relogin) promptLogin();
              if (onFail) onFail({ message: e.relogin ? '로그인이 필요합니다. 하단에서 로그인한 뒤 다시 저장해 주세요.' : e.message });
            });
          };
        }
      });
    }
    window.google.script = { run: runner(null, null) };
  }

  // ---------- 흐름 ----------
  function render(data) {
    document.getElementById('loading-overlay').style.display = 'none';
    onDataLoaded(data);
  }

  /** 저장 뒤 화면은 그대로 두고, 다음 접속 때 보일 저장본만 최신으로 바꾼다 */
  var quietTimer = null;
  function refreshSnapshotQuietly() {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () {
      fetchSheets().then(function (data) { save(KEY_SNAPSHOT, { at: Date.now(), data: data }); }).catch(function () {});
    }, 1500);
  }

  function promptLogin(prefix) {
    status((prefix || '') + '최신 데이터를 보고 저장하려면 로그인하세요.', { label: 'Google 로그인', onClick: function () { refresh(true); } });
  }

  /** 파일 권한이 없으면(처음 로그인 직후 등) 파일 선택 창을 띄운 뒤 다시 읽는다 */
  function fetchWithFile() {
    return fetchSheets().catch(function (e) {
      if (!e.needFile) throw e;
      status('가계부 파일(우리집가계부)을 선택해 주세요.');
      var overlay = document.getElementById('loading-overlay');
      var wasShown = overlay.style.display !== 'none';
      overlay.style.display = 'none'; // 불러오는 중 가림막이 선택 창을 덮지 않게 한다
      return pickFile().then(function () {
        if (wasShown) overlay.style.display = 'flex';
        return fetchSheets();
      });
    });
  }

  function refresh(interactive) {
    var started = Date.now();
    status('최신 데이터 불러오는 중…');
    return accessToken(interactive).then(function () {
      t.token = Date.now();
      return fetchWithFile();
    }).then(function (data) {
      t.fetched = Date.now();
      save(KEY_SNAPSHOT, { at: Date.now(), data: data });
      render(data);
      t.fresh = Date.now();
      console.log('[웹 계측]', JSON.stringify({ 저장본표시: t.cached ? t.cached - t.nav : null, 토큰: t.token - started,
        시트읽기: t.fetched - t.token, 최신표시: t.fresh - t.nav }));
      hideStatus(); // 정상일 때는 하단 줄을 띄우지 않는다 (로그인 필요·오류 때만 표시)
    }).catch(function (err) {
      var snap = load(KEY_SNAPSHOT);
      var base = snap ? ago(Date.now() - snap.at) + ' 저장본 표시 중 · ' : '';
      if (err.relogin) promptLogin(base);
      else if (err.needFile) status(base + err.message, { label: '파일 선택', onClick: function () { pickFile().then(function () { refresh(true); }, function (e) { status(e.message); }); } });
      else status(base + err.message, { label: '다시 시도', onClick: function () { refresh(true); } });
      if (!snap) document.getElementById('loading-overlay').style.display = 'none';
    });
  }

  function start() {
    installScriptRun();
    cfg = readConfigFromHash();
    if (!cfg) {
      document.getElementById('loading-overlay').style.display = 'none';
      status('설정이 없습니다. 안내받은 첫 접속 주소로 한 번 열어 주세요.');
      return;
    }
    var snap = load(KEY_SNAPSHOT);
    if (snap && snap.data) {
      render(snap.data);
      t.cached = Date.now();
      status(ago(Date.now() - snap.at) + ' 저장본 표시 중 · 최신 데이터 확인 중…');
    } else {
      document.getElementById('loading-overlay').style.display = 'flex';
    }
    // 로그인 창은 사용자가 누른 뒤에만 띄울 수 있어(팝업 차단), 토큰이 없으면 버튼을 보여 준다
    refresh(false);
  }

  // 이미 열린 페이지에서 첫 접속 주소(#cid=…)를 다시 연 경우에도 설정을 받는다
  window.addEventListener('hashchange', function () {
    if (/[#&]cid=/.test(location.hash)) { readConfigFromHash(); location.reload(); }
  });

  // Common.html의 loadData를 대체한다 (DOMContentLoaded에서 이 이름으로 호출된다)
  window.loadData = start;
})();
