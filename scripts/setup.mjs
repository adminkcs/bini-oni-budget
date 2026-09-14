// 새 PC(Windows/macOS 공통)에서 clasp 연동을 복구한다.
//
// .clasp.json(Script ID)과 .clasp-prod(운영 배포 ID = 웹앱 URL)는 저장소에 커밋하지 않는다.
// 저장소가 나중에 공개로 바뀌어도 노출되지 않게 하기 위함이다.
// 그래서 clone 직후에는 clasp 명령이 동작하지 않으며, 이 스크립트로 재생성한다.
//
//   npm install
//   npx clasp login
//   npm run setup -- <Script ID>
//
// Script ID 확인: 시트 > 확장 프로그램 > Apps Script > ⚙️ 프로젝트 설정 > 스크립트 ID

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Windows에서는 npx.cmd 를 써야 spawn이 실패하지 않는다
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function fail(msg) {
  console.error('\n[오류] ' + msg + '\n');
  process.exit(1);
}

function runClasp(args) {
  const r = spawnSync(npx, ['clasp', ...args], { encoding: 'utf8' });
  return ((r.stdout || '') + (r.stderr || '')).trim();
}

const scriptId = (process.argv[2] || '').trim();

if (!scriptId) {
  fail(
    'Script ID를 인자로 주세요.\n\n' +
    '  npm run setup -- <Script ID>\n\n' +
    'Script ID 확인 경로:\n' +
    '  가계부 시트 > 확장 프로그램 > Apps Script > ⚙️ 프로젝트 설정 > 스크립트 ID'
  );
}
if (!/^[A-Za-z0-9_-]{20,}$/.test(scriptId)) {
  fail(`Script ID 형식이 아닙니다: ${scriptId}`);
}

console.log('');

// ── 1) .clasp.json ───────────────────────────────────────────────
if (existsSync('.clasp.json')) {
  console.log('·  .clasp.json 이미 있음 — 건너뜀');
} else {
  writeFileSync('.clasp.json', JSON.stringify({
    scriptId,
    rootDir: '.',
    scriptExtensions: ['.js', '.gs'],
    htmlExtensions: ['.html'],
    jsonExtensions: ['.json'],
    filePushOrder: [],
    skipSubdirectories: false
  }, null, 2) + '\n');
  console.log('✅ .clasp.json 생성');
}

// ── 2) clasp 로그인 확인 ─────────────────────────────────────────
const who = runClasp(['show-authorized-user']);
if (!/logged in as/i.test(who)) {
  console.log('\n·  clasp 로그인이 필요합니다. 아래를 실행한 뒤 이 명령을 다시 실행하세요.\n');
  console.log('     npx clasp login\n');
  console.log('   (브라우저가 열립니다. 가계부 시트 소유 계정으로 승인하세요)\n');
  process.exit(0);
}
console.log('✅ ' + who.split('\n')[0]);

// ── 3) .clasp-prod (운영 배포 ID) ────────────────────────────────
if (existsSync('.clasp-prod') && readFileSync('.clasp-prod', 'utf8').trim()) {
  console.log('·  .clasp-prod 이미 있음 — 건너뜀');
} else {
  const raw = runClasp(['list-deployments', '--json']);
  let list = [];
  try {
    list = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
  } catch (e) {
    console.log('\n·  배포 목록을 읽지 못했습니다. 아래로 직접 확인해 .clasp-prod 에 한 줄로 저장하세요.\n');
    console.log('     npm run deployments\n');
    process.exit(0);
  }

  // @HEAD(테스트용)는 versionNumber가 없다. 버전이 매겨진 것 중 최신을 운영으로 본다.
  const versioned = list.filter(d => typeof d.versionNumber === 'number')
                        .sort((a, b) => b.versionNumber - a.versionNumber);

  if (versioned.length === 0) {
    console.log('\n·  버전이 매겨진 배포가 없습니다. 운영 배포를 먼저 만든 뒤 다시 실행하세요.\n');
  } else if (versioned.length > 1 &&
             versioned[0].versionNumber === versioned[1].versionNumber) {
    // 같은 버전의 배포가 둘 이상이면 어느 쪽이 운영인지 단정할 수 없다
    console.log('\n·  운영 배포를 특정할 수 없습니다. 아래 중 하나를 .clasp-prod 에 한 줄로 저장하세요.\n');
    versioned.forEach(d => console.log(`     ${d.deploymentId}  @${d.versionNumber}  ${d.description || ''}`));
    console.log('');
  } else {
    const prod = versioned[0];
    writeFileSync('.clasp-prod', prod.deploymentId + '\n');
    console.log(`✅ .clasp-prod 생성  (@${prod.versionNumber} ${prod.description || ''})`);
  }
}

// ── 4) 안내 ──────────────────────────────────────────────────────
console.log('\n다음으로 할 일');
console.log('  1) git 커밋 이메일을 이 저장소에만 지정 (전역 설정은 건드리지 않음)');
console.log('       git config --local user.email "본인이메일"');
console.log('       git config --local user.name  "본인이름"');
console.log('  2) 서버와 로컬이 같은지 확인');
console.log('       npm run pull   →   git status   (변경 없으면 동일)');
console.log('  3) 테스트');
console.log('       npm test\n');
