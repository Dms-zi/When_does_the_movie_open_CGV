import { fetchCgvSnapshot } from '../src/cgv.mjs';

try {
  const movies = await fetchCgvSnapshot();
  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), theater: 'CGV 의정부', movieCount: movies.length, movies }, null, 2));
} catch (error) {
  console.error(`연결 검증 실패: ${error.message}`);
  process.exitCode = 1;
}
