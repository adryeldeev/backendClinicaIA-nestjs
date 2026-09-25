/**
 * Trava de lint (roda em CI, uma vez configurado — nao ha pipeline de CI
 * ainda neste repositorio, ver comentario abaixo): a opcao `repeat` do
 * BullMQ (`queue.add(..., {repeat: {...}})`) so pode aparecer em
 * src/shared/queue/register-repeatable-job.ts. Qualquer outro lugar
 * reintroduz o incidente de 2026-09-23 (ver CLAUDE.md — "Armadilhas ja
 * encontradas") — cada boot criaria sua propria ocorrencia agendada sem
 * limpar a do boot anterior, represando ocorrencias vencidas no Redis.
 *
 * Uso: npm run check:repeatables
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_DIR = resolve(__dirname, '..', 'src');
const ALLOWED_FILE = resolve(SRC_DIR, 'shared', 'queue', 'register-repeatable-job.ts');
const REPEAT_OPTION_PATTERN = /\brepeat\s*:/;

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const fullPath = join(dir, name);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return listTsFiles(fullPath);
    }
    if (stats.isFile() && fullPath.endsWith('.ts')) {
      return [fullPath];
    }
    return [];
  });
}

function main(): void {
  const violations: string[] = [];

  for (const file of listTsFiles(SRC_DIR)) {
    if (resolve(file) === ALLOWED_FILE) {
      continue;
    }
    const content = readFileSync(file, 'utf-8');
    if (REPEAT_OPTION_PATTERN.test(content)) {
      violations.push(relative(process.cwd(), file));
    }
  }

  if (violations.length > 0) {
    console.error(
      'A opcao `repeat` do BullMQ so pode aparecer em src/shared/queue/register-repeatable-job.ts — ' +
        'registrar um repeatable direto em outro lugar reintroduz o bug do incidente de 2026-09-23 ' +
        '(ver CLAUDE.md): ocorrencia represada entre reinicios do app dispara assim que um worker reconecta.\n',
    );
    console.error('Arquivo(s) com `repeat:` fora do permitido:');
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    console.error('\nUse registerRepeatableJob(queue, jobId, everyMs) em vez de queue.add(..., {repeat: ...}) direto.');
    process.exitCode = 1;
    return;
  }

  console.log('OK: nenhuma opcao `repeat` do BullMQ fora de register-repeatable-job.ts.');
}

main();
