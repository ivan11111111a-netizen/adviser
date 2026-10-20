import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  type LanguageModelUsage,
} from 'ai';
import { InvalidResponseError, type Provider } from '../core/engine';

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey?: string;
  model: string;
}

/** OpenRouter, Ollama (`/v1`), LM Studio и другие OpenAI-совместимые серверы. */
export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): Provider {
  const provider = createOpenAICompatible({
    name: 'adviser',
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    supportsStructuredOutputs: true,
  });
  return {
    async complete(request, signal, onUsage) {
      const report = (usage?: LanguageModelUsage) =>
        usage &&
        onUsage?.({ inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 });
      try {
        // jsonSchema без validate: SDK только разбирает JSON, схему проверяет движок.
        const { output, usage } = await generateText({
          model: provider.chatModel(options.model),
          instructions: request.system,
          prompt: request.prompt,
          output: Output.object({ schema: jsonSchema(request.jsonSchema) }),
          abortSignal: signal,
        });
        report(usage);
        return output;
      } catch (e) {
        if (NoObjectGeneratedError.isInstance(e)) {
          // Токены ушли и на ответ не по схеме.
          report(e.usage);
          throw new InvalidResponseError(e.message);
        }
        throw e;
      }
    },
  };
}
