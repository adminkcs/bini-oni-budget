// [계측] 첫 화면 로딩 구간 계산 (buildLoadPerfRecord)
const { loadCommon, runner } = require('./_stub');
const r = runner();
const ctx = loadCommon();

const B = 1790000000000; // 실제 epoch(ms) 규모
const server = { view: 'mobile', start: B + 100000, end: B + 104000, total: 4000, auth: 300, dataAuth: 200, batchGet: 1500, parse: 400, serialize: 100, template: 1500, kb: 250 };
const browser = { origin: B + 106000, t0: B + 106500, dcl: B + 107000, dataDone: B + 107300, paint: B + 108000, viaBootstrap: true, txnCount: 900 };

console.log('=== 직접 진입 (?view=mobile) ===');
{
  const rec = ctx.buildLoadPerfRecord(Object.assign({ server }, browser));
  r.check('진입', rec.진입, '직접');
  r.check('총소요 = 서버 시작 → 그려짐', rec.총소요, 8000);
  r.check('라우터 구간 없음', rec.라우터, '');
  r.check('권한확인 = doGet + 데이터조회 합', rec.권한확인, 500);
  r.check('스크립트시작', rec.스크립트시작, 500);
  r.check('DOM준비', rec.DOM준비, 500);
  r.check('데이터반영', rec.데이터반영, 300);
  r.check('렌더', rec.렌더, 700);
  r.check('서버끝→화면시작', rec.상세['서버끝→화면시작(시계차 포함)'], 2000);
}

console.log('\n=== 라우터 경유 ===');
{
  const s = Object.assign({}, server, { router: { rs: B + 90000, r0: B + 92000, rt: B + 93000, rm: false } });
  const rec = ctx.buildLoadPerfRecord(Object.assign({ server: s }, browser));
  r.check('진입', rec.진입, '라우터');
  r.check('총소요 = 라우터 서버 시작 → 그려짐', rec.총소요, 18000);
  r.check('라우터 화면 체류', rec.라우터, 1000);
  r.check('서버+전달 = 이동 → 화면 시작', rec['서버+전달'], 13000);
  r.check('구글/네트워크 = 서버+전달 − 서버합계', rec['구글/네트워크'], 9000);
}

console.log('\n=== 수동 버튼 / 오래된 rt ===');
{
  const s1 = Object.assign({}, server, { router: { rs: B + 90000, r0: B + 92000, rt: B + 93000, rm: true } });
  r.check('수동 버튼 표시', ctx.buildLoadPerfRecord(Object.assign({ server: s1 }, browser)).진입, '라우터(수동버튼)');
  const s2 = Object.assign({}, server, { router: { rs: B - 900000, r0: B - 899000, rt: B - 898000, rm: false } });
  const rec = ctx.buildLoadPerfRecord(Object.assign({ server: s2 }, browser));
  r.check('2분 넘은 rt는 직접 진입으로', rec.진입, '직접');
  r.check('총소요는 서버 시작 기준', rec.총소요, 8000);
}

console.log('\n=== 폴백 / 값 누락 ===');
{
  const rec = ctx.buildLoadPerfRecord({ server: {}, origin: 0, t0: 0, dcl: 5, dataDone: 9, paint: 10, viaBootstrap: false });
  r.check('부트스트랩 실패 표시', rec.진입, '폴백(비동기)');
  r.check('시각 없으면 빈칸', rec.총소요, '');
  r.check('서버값 없으면 빈칸', rec.서버합계, '');
}

r.done();
