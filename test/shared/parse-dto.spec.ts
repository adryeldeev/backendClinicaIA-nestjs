import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { parseDto } from '../../src/shared/http/parse-dto';

/**
 * Achado do usuario (2026-09-25): requisicao SEM Content-Type: application/json
 * chega aqui com `input === undefined` (nao `{}`) — pro schema so de
 * campos opcionais, isso rejeitava na raiz mesmo sem nenhum campo
 * obrigatorio de verdade. Corpo opcional tem que ser opcional de verdade.
 */
describe('parseDto', () => {
  it('schema so com campos opcionais: undefined na raiz (corpo ausente) e aceito como {}', () => {
    const schema = z.object({ motivo: z.string().optional() });
    expect(parseDto(schema, undefined)).toEqual({});
  });

  it('schema so com campos opcionais: {} (corpo vazio explicito) continua aceito, mesmo resultado', () => {
    const schema = z.object({ motivo: z.string().optional() });
    expect(parseDto(schema, {})).toEqual({});
  });

  it('schema com campo obrigatorio: undefined na raiz ainda rejeita, pelo campo que falta de verdade', () => {
    const schema = z.object({ novoStartsAt: z.coerce.date() });
    expect(() => parseDto(schema, undefined)).toThrow(BadRequestException);
  });

  it('valores presentes continuam validados normalmente (nao vira sempre {})', () => {
    const schema = z.object({ motivo: z.string().optional() });
    expect(parseDto(schema, { motivo: 'teste' })).toEqual({ motivo: 'teste' });
  });
});
