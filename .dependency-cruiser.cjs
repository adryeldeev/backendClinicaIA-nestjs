/**
 * Regras de fronteira do monolito modular (SPEC.md secao 6, MM-01 a
 * MM-07). So MM-01, MM-04, MM-05 e MM-07 sao checaveis por grafo de
 * import puro — MM-02 (o que o index.ts exporta), MM-03 (quem escreve em
 * qual tabela) e MM-06 (agent nao duplicar regra de negocio) continuam
 * disciplina manual/revisao, nenhuma ferramenta de grafo de import
 * enxerga isso.
 *
 * O grafo de direcao abaixo foi derivado das importacoes REAIS do
 * codigo (nao só do diagrama ASCII da secao 6, que estava incompleto —
 * corrigido no mesmo commit) — cada modulo so pode importar quem ja
 * importa hoje, de proposito. Uma aresta nova precisa passar por aqui
 * conscientemente, nao só evitar virar ciclo (achado do usuario:
 * no-circular sozinho pega o problema tarde demais).
 */
module.exports = {
  forbidden: [
    {
      name: 'mm-01-no-deep-cross-module-import',
      comment: 'MM-01: um modulo so importa outro pelo index.ts dele.',
      severity: 'error',
      from: {
        path: '^src/modules/([^/]+)/',
      },
      to: {
        path: '^src/modules/([^/]+)/(?!index\\.ts$).+',
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'mm-01-no-deep-import-from-outside-modules',
      comment: 'MM-01: app.module.ts/main.ts/shared/scripts tambem so entram por index.ts.',
      severity: 'error',
      from: {
        path: '^(src/(shared|scripts)/|src/(main|app\\.module)\\.ts$)',
      },
      to: {
        path: '^src/modules/[^/]+/(?!index\\.ts$).+',
      },
    },
    {
      // Achado real ao validar contra o codigo: identity/domain/authenticated-user.ts
      // importa `type UserRole` do @prisma/client — import type, zero
      // pegada em runtime (some na compilacao), diferente de importar
      // PrismaClient/chamar metodo. dependencyTypesNot exclui so esse
      // caso; import de VALOR (runtime) continua proibido.
      name: 'mm-04-domain-no-framework',
      comment: 'MM-04: domain/ nao importa NestJS, Prisma nem axios (exceto tipo — sem pegada em runtime).',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/domain/',
      },
      to: {
        path: '^node_modules/(@nestjs/|@prisma/client|axios)',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'mm-04-domain-no-infrastructure',
      comment: 'MM-04: domain/ nao importa infrastructure/ (nem do proprio modulo, nem de outro) — nem tipo, infrastructure e implementacao, nao vocabulario compartilhado.',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/domain/',
      },
      to: {
        path: '/infrastructure/',
      },
    },
    {
      name: 'mm-05-no-circular',
      comment: 'MM-05: dependencia circular entre modulos e proibida.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: { circular: true },
    },
    {
      name: 'mm-07-shared-no-modules',
      comment: 'MM-07: shared/ e infraestrutura transversal, nunca importa de modules/.',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/modules/' },
    },

    // --- Direcao do grafo (secao 6) — uma aresta por modulo de origem,
    // listando os modulos que ele NAO pode importar. identity nunca
    // aparece como alvo proibido: todo modulo pode importar identity
    // (guards/RBAC), e identity em si nao importa nenhum outro.
    {
      name: 'graph-direction-catalog',
      severity: 'error',
      comment: 'catalog so importa identity.',
      from: { path: '^src/modules/catalog/' },
      to: { path: '^src/modules/(scheduling|conversation|agent|knowledge|messaging|metrics)/' },
    },
    {
      name: 'graph-direction-scheduling',
      severity: 'error',
      comment: 'scheduling so importa catalog e identity.',
      from: { path: '^src/modules/scheduling/' },
      to: { path: '^src/modules/(conversation|agent|knowledge|messaging|metrics)/' },
    },
    {
      name: 'graph-direction-conversation',
      severity: 'error',
      comment: 'conversation so importa agent, catalog e identity.',
      from: { path: '^src/modules/conversation/' },
      to: { path: '^src/modules/(scheduling|knowledge|messaging|metrics)/' },
    },
    {
      name: 'graph-direction-agent',
      severity: 'error',
      comment: 'agent so importa catalog, knowledge, scheduling e identity.',
      from: { path: '^src/modules/agent/' },
      to: { path: '^src/modules/(conversation|messaging|metrics)/' },
    },
    {
      name: 'graph-direction-knowledge',
      severity: 'error',
      comment: 'knowledge so importa identity.',
      from: { path: '^src/modules/knowledge/' },
      to: { path: '^src/modules/(catalog|scheduling|conversation|agent|messaging|metrics)/' },
    },
    {
      name: 'graph-direction-messaging',
      severity: 'error',
      comment: 'messaging so importa conversation, scheduling e identity.',
      from: { path: '^src/modules/messaging/' },
      to: { path: '^src/modules/(catalog|agent|knowledge|metrics)/' },
    },
    {
      name: 'graph-direction-metrics',
      severity: 'error',
      comment: 'metrics so importa conversation, scheduling e identity.',
      from: { path: '^src/modules/metrics/' },
      to: { path: '^src/modules/(catalog|agent|knowledge|messaging)/' },
    },
    {
      name: 'graph-direction-identity',
      severity: 'error',
      comment: 'identity nao importa nenhum outro modulo — e a base.',
      from: { path: '^src/modules/identity/' },
      to: { path: '^src/modules/(catalog|scheduling|conversation|agent|knowledge|messaging|metrics)/' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
