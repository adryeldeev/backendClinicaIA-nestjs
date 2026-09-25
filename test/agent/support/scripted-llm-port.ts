import type { LlmCompletionInput, LlmCompletionResult, LlmPort } from '../../../src/modules/agent';

export type ScriptedResponse = LlmCompletionResult | { throws: Error };

/**
 * LlmPort deterministico para teste: devolve as respostas do script, na
 * ordem, uma por chamada de complete(). Se o script acabar, repete a
 * ultima resposta (util pra testar MAX_ITERATIONS com um script curto de
 * "sempre pede a mesma tool de novo").
 *
 * Nunca chama rede — nenhum teste que usa isso toca o Gemini real.
 */
export class ScriptedLlmPort implements LlmPort {
  private callIndex = 0;
  private script: ScriptedResponse[];
  public receivedInputs: LlmCompletionInput[] = [];

  constructor(script: ScriptedResponse[]) {
    if (script.length === 0) {
      throw new Error('ScriptedLlmPort precisa de pelo menos uma resposta no script.');
    }
    this.script = script;
  }

  get callCount(): number {
    return this.callIndex;
  }

  /**
   * Troca o script e zera o estado — pra reusar a MESMA instancia injetada
   * por DI (o moduleRef so resolve LLM_PORT uma vez no compile()) em varios
   * `it()` de um mesmo describe, sem precisar subir um app Nest por teste.
   */
  setScript(script: ScriptedResponse[]): void {
    if (script.length === 0) {
      throw new Error('ScriptedLlmPort precisa de pelo menos uma resposta no script.');
    }
    this.script = script;
    this.callIndex = 0;
    this.receivedInputs = [];
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    this.receivedInputs.push(input);
    const response = this.script[this.callIndex] ?? this.script[this.script.length - 1];
    this.callIndex += 1;

    if ('throws' in response) {
      throw response.throws;
    }
    return response;
  }
}
