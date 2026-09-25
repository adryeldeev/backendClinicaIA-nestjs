import { Prisma } from '@prisma/client';
import { DuplicateEntryError } from '../kernel/errors/duplicate-entry.error';
import { ExclusionViolationError } from '../kernel/errors/exclusion-violation.error';
import { RecordNotFoundError } from '../kernel/errors/record-not-found.error';
import { ReferencedEntityNotFoundError } from '../kernel/errors/referenced-entity-not-found.error';

// SQLSTATE do Postgres pra "exclusion_violation" (constraint EXCLUDE) —
// mesma constante que ja existia isolada em prisma-appointment.repository.ts,
// centralizada aqui porque agora e a extensao (nao mais o repositorio) quem
// decide se um erro e 23P01.
const POSTGRES_EXCLUSION_VIOLATION_CODE = '23P01';

/**
 * Traduz os codigos CONHECIDOS do Prisma pra erro de dominio, na camada de
 * infraestrutura — achado do usuario, regressao de 2026-09-24: toda rota
 * que cria/atualiza entidade com FK vinda do corpo (profissional/
 * procedimento->clinicId, consulta->professionalId/patientId/procedureId,
 * regra/excecao de disponibilidade->professionalId, usuario->
 * professionalId) tinha o mesmo buraco — violacao de FK/unique/registro
 * nao encontrado vazava cru pro AllExceptionsFilter, virando 500 generico
 * pra um erro que e do CLIENTE (dado invalido/duplicado/inexistente), nao
 * interno. Nao interpola nome de constraint/coluna na mensagem pro
 * cliente (SEC-02) — so os campos de `meta.target` do P2002, que pro
 * provider Postgres sao nome de coluna real, nao identificador interno.
 *
 * Segundo achado do usuario, mesmo dia: a cobertura acima e so pra
 * `PrismaClientKnownRequestError` (P20xx). 23P01 (violacao de constraint
 * EXCLUDE, usada por `appointment_no_overlap`) e OUTRO tipo —
 * `PrismaClientUnknownRequestError`, o Prisma nao reconhece
 * exclusion_violation como "known error" — e so era tratada no UNICO
 * call site que ja sabia procurar por ela (isSlotConflict). Qualquer
 * OUTRA constraint EXCLUDE que existisse ou viesse a existir batia direto
 * no filtro generico. Tratada aqui tambem agora — mesma classe de bug, tipo
 * de erro diferente do Prisma.
 *
 * So traduz os codigos/tipos conhecidos com significado generico e seguro
 * de expor. Qualquer outro erro (incluindo `PrismaClientUnknownRequestError`
 * por motivo diferente de 23P01) passa direto — o `AllExceptionsFilter`
 * continua sendo a rede de seguranca pro que e de fato inesperado.
 */
export function mapPrismaError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2003': // Foreign key constraint violated
        return new ReferencedEntityNotFoundError(extractFkField(error.meta));
      case 'P2002': {
        // meta.target pro provider Postgres e string[] com nome de coluna real.
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.map(String) : [];
        return new DuplicateEntryError(fields);
      }
      case 'P2025': // Record to update/delete does not exist
        return new RecordNotFoundError();
      default:
        return error;
    }
  }

  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes(POSTGRES_EXCLUSION_VIOLATION_CODE)
  ) {
    return new ExclusionViolationError(extractExclusionConstraint(error.message));
  }

  return error;
}

/**
 * Confirmado na mao contra o Postgres real (nao documentado, nem
 * estruturado em `meta` como P2002/P2003 — string crua de um dump de erro
 * do connector): a mensagem traz `exclusion constraint \"nome\"` — com
 * BARRA INVERTIDA literal antes de cada aspas (o dump em Rust escapa a
 * string aninhada), nao aspas simples como a primeira tentativa assumiu.
 * Confirmado via char code (92 = "\", 34 = '"'), nao so lendo o texto —
 * um regex ingenuo com aspas simples silenciosamente nunca casava e
 * `constraint` sempre saia `undefined` (pego pelo teste e2e, nao por
 * inspecao visual). So extrai quando o padrao bate — senao volta
 * `undefined`, a traducao generica nao depende disso pra funcionar.
 */
function extractExclusionConstraint(message: string): string | undefined {
  return message.match(/exclusion constraint \\?"([^"\\]+)\\?"/)?.[1];
}

/**
 * Provider Postgres: `meta` do P2003 traz `{modelName, constraint}`, sem
 * campo separado pra nome de coluna — confirmado na mao contra o Postgres
 * real (nao documentado pelos tipos do Prisma). `constraint` segue a
 * convencao padrao do Prisma pra nome de FK: `${modelName}_${campo}_fkey`
 * (ex.: "Appointment_professionalId_fkey" -> "professionalId"). So extrai
 * quando o formato bate essa convencao — senao volta `undefined`, a
 * traducao generica nao depende disso pra funcionar.
 */
function extractFkField(meta: Record<string, unknown> | undefined): string | undefined {
  const modelName = meta?.modelName;
  const constraint = meta?.constraint;
  if (typeof modelName !== 'string' || typeof constraint !== 'string') {
    return undefined;
  }
  const prefix = `${modelName}_`;
  const suffix = '_fkey';
  if (!constraint.startsWith(prefix) || !constraint.endsWith(suffix)) {
    return undefined;
  }
  return constraint.slice(prefix.length, constraint.length - suffix.length);
}
