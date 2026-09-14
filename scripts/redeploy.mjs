// 운영 배포(@11)를 갱신해 웹앱 URL을 유지한다.
// npm script에 $(cat ...)을 쓰면 Windows(cmd/PowerShell)에서 동작하지 않으므로
// 크로스 플랫폼 node 스크립트로 분리했다.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ID_FILE = '.clasp-prod';
if (!existsSync(ID_FILE)) {
  console.error(`[오류] ${ID_FILE} 파일이 없습니다.`);
  console.error('  운영 배포 ID를 확인해 이 파일에 한 줄로 저장하세요:  npm run deployments');
  process.exit(1);
}

const id = readFileSync(ID_FILE, 'utf8').trim();
if (!id) {
  console.error(`[오류] ${ID_FILE} 이 비어 있습니다.`);
  process.exit(1);
}

const args = process.argv.slice(2);
console.log(`운영 배포 갱신: ${id.slice(0, 16)}...  ${args.join(' ')}`);
// shell:true 를 쓰면 공백이 든 인자(-d "설명 문구")가 쉘에서 다시 쪼개져
// clasp이 "too many arguments" 로 실패한다. 셸을 거치지 않고 인자를 그대로 전달한다.
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const r = spawnSync(npx, ['clasp', 'update-deployment', id, ...args], {
  stdio: 'inherit'
});
process.exit(r.status ?? 1);
