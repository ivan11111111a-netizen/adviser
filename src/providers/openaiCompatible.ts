import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, jsonSchema, NoObjectGeneratedError, Output } from 'ai';
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
    async complete(request, signal) {
      try {
        // jsonSchema без validate: SDK только разбирает JSON, схему проверяет движок.
        const { output } = await generateText({
          model: provider.chatModel(options.model),
          instructions: request.system,
          prompt: request.prompt,
          output: Output.object({ schema: jsonSchema(request.jsonSchema) }),
          abortSignal: signal,
        });
        return output;
      } catch (e) {
        if (NoObjectGeneratedError.isInstance(e)) {
          throw new InvalidResponseError(e.message);
        }
        throw e;
      }
    },
  };
}
