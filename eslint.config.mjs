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
 * CONTAGEM ATUAL: 272 (medida em 2026-09-24). Chegou a subir pra 314
 * (alinhamento da busca + fix do deadlock + testes novos) antes de cair
 * aqui — achado do usuario: 15 warnings novos num lote so e divida
 * acumulando no mesmo ritmo em que a antiga e paga, regra daqui pra
 * frente e codigo novo nao aumentar o ratchet. Causa raiz real, nao so
 * dos 2 arquivos novos: `INestApplication.getHttpServer()` sem o generic
 * e tipado `any` (`@nestjs/core/nest-application.d.ts`) — todo teste e2e
 * que faz `request(app.getHttpServer())` sem `app: INestApplication<Server>`
 * (de `node:http`) espalha `any` por `response.body` inteiro. Tipar o
 * generic nos 2 arquivos tocados nesta leva nao so zerou os 15 novos como
 * baixou 19 warnings JA EXISTENTES em conversations-admin-controller.e2e-spec.ts
 * (269->250 so nesse arquivo) — o generic ja existia na interface do
 * Nest, so ninguem usava. Os ~50 arquivos e2e restantes do projeto ainda
 * usam `INestApplication` sem o generic (divida antiga, ratcheada desde
 * o dia zero) — aplicar esse padrao neles e refactor separado, fora do
 * escopo pontual que gerou este achado. So desce a partir daqui. Se
 * corrigir alguma, baixe o numero em package.json/scripts/lint junto no
 * mesmo commit — nunca so aumente pra fazer o CI passar.
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
