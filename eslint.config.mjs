// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Primeiro lint real deste projeto (2026-09-23) — 207 warnings de dia zero
 * num codigo que nunca foi lintado (quase todas "unsafe" em torno de
 * Prisma/Zod, tipo perdido na borda — ver breakdown no commit). A UNICA
 * violacao de no-floating-promises (bootstrap() sem catch em main.ts) foi
 * corrigida na hora, nao ratcheada — bug real, nao ruido. Corrigir as
 * outras 207 de uma vez nao era o pedido; a divida fica travada (nunca
 * cresce, so diminui) via `--max-warnings=207` no CI/package.json, nao
 * escondida atras de regra desligada.
 *
 * CONTAGEM ATUAL: 239 (medida em 2026-09-25). Regra travada pelo usuario
 * depois do achado de 2026-09-24 (299->272, ver historico do arquivo):
 * "codigo novo nao aumenta o ratchet — se em algum caso for inevitavel,
 * o motivo e dito ANTES de subir o numero, nao depois." Aplicada de
 * verdade aqui: um lote de 4 arquivos de teste novos/tocados (rotas de
 * paciente + agenda) tinha subido o numero pra 299 (+27) por causa do
 * mesmo padrao ja identificado (`INestApplication` sem o generic
 * `<Server>`, `response.body` sem tipo) — corrigido nos 4 antes de
 * commitar, nao depois. Resultado: 239, MENOR que o 272 anterior (o
 * fix nos 2 arquivos pre-existentes tocados no lote eliminou debito que
 * ja estava la). Os arquivos e2e restantes do projeto ainda usam
 * `INestApplication` sem o generic (divida antiga) — corrigido so
 * quando o arquivo e tocado por outro motivo, nao um refactor em massa
 * a parte. So desce a partir daqui. Se corrigir alguma, baixe o numero
 * em package.json/scripts/lint junto no mesmo commit — nunca so aumente
 * pra fazer o CI passar.
 *
 * Downgrade pra 'warn' e so pras regras SEM violacao hoje que o CLAUDE.md
 * ja exigia como inegociavel de verdade (no-explicit-any,
 * no-floating-promises) — essas ficam 'error', sem excecao, mesmo que o
 * preset padrao as marque como recomendadas junto com o resto.
 */
function downgradeToWarn(configs) {
  return configs.map((config) => {
    if (!config.rules) return config;
    const rules = {};
    for (const [name, value] of Object.entries(config.rules)) {
      rules[name] = Array.isArray(value) ? ['warn', ...value.slice(1)] : 'warn';
    }
    return { ...config, rules };
  });
}

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  ...downgradeToWarn([js.configs.recommended]),
  ...downgradeToWarn(tseslint.configs.recommendedTypeChecked),
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // no-undef e no-unused-vars puros do eslint:recommended nao entendem
      // TS (falso positivo em tipo/interface/overload) e sao superados
      // pelas versoes @typescript-eslint — pratica documentada oficial do
      // typescript-eslint, nao afrouxamento de regra.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'require-await': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
);
