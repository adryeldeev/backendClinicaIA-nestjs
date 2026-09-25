/**
 * CLI de ingestao (secao 11 da SPEC.md) — comitado, nao descartavel.
 *
 * Uso:
 *   npm run knowledge:ingest -- <arquivo.md> --categoria <categoria> [--fonte <sourceRef>] [--titulo <titulo>]
 *
 * Categorias esperadas (secao 7): preparo_exame | convenio | localizacao | procedimento | geral.
 * Reingerir o mesmo --fonte cria uma nova versao e desativa a anterior — nunca apaga (ver IngestDocumentUseCase).
 *
 * Indice HNSW (KnowledgeChunk.embedding) criado na migration
 * 20260922015409_knowledge_chunk_hnsw_index (Fase 6, Etapa 5) — antes disso
 * ficava deliberadamente adiado (base vazia/pequena, HNSW construido cedo
 * fica pior do que reconstruido depois), mas o painel admin passou a ser o
 * jeito real de popular a base a partir desta etapa.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../src/modules/knowledge';
import { validateEnv } from '../src/shared/config/env.schema';
import { DatabaseModule } from '../src/shared/database/database.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), DatabaseModule, KnowledgeModule],
})
class IngestCliModule {}

interface ParsedArgs {
  filePath: string;
  categoria: string;
  fonte: string | null;
  titulo: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [filePath, ...rest] = argv;
  if (!filePath) {
    throw new Error('Uso: npm run knowledge:ingest -- <arquivo.md> --categoria <categoria> [--fonte <ref>] [--titulo <titulo>]');
  }

  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '');
    const value = rest[i + 1];
    if (key && value) {
      flags[key] = value;
    }
  }

  if (!flags.categoria) {
    throw new Error('Faltou --categoria (preparo_exame | convenio | localizacao | procedimento | geral).');
  }

  return {
    filePath,
    categoria: flags.categoria,
    fonte: flags.fonte ?? null,
    titulo: flags.titulo ?? null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const content = readFileSync(args.filePath, 'utf-8');
  const titulo = args.titulo ?? basename(args.filePath, extname(args.filePath));

  const app = await NestFactory.createApplicationContext(IngestCliModule);
  const { IngestDocumentUseCase } = await import('../src/modules/knowledge');
  const ingest = app.get(IngestDocumentUseCase);

  const result = await ingest.execute({
    title: titulo,
    category: args.categoria,
    sourceRef: args.fonte,
    content,
  });

  console.log('Ingestao concluida:');
  console.log(`  documentId: ${result.documentId}`);
  console.log(`  versao: ${result.version}`);
  console.log(`  chunks: ${result.chunkCount}`);

  await app.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
