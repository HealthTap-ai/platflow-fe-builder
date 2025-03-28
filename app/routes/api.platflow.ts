import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream } from 'ai';
import { type FileMap } from '~/lib/.server/llm/constants';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { createSummary } from '~/lib/.server/llm/create-summary';

export async function action(args: ActionFunctionArgs) {
  return builderAction(args);
}

const logger = createScopedLogger('api.builder');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

async function builderAction({ context, request }: ActionFunctionArgs) {
  const { messages, files, promptId, contextOptimization, builderConfig } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
    builderConfig?: {
      backendUrl: string;
      apiKey?: string;
      options?: Record<string, any>;
    };
  }>();

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(
    parseCookies(cookieHeader || '').providers || '{}',
  );

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let lastChunk: string | undefined = undefined;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const dataStream = createDataStream({
      async execute(dataStream) {
        const filePaths = getFilePaths(files || {});
        const filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        if (messages.length > 3) {
          messageSliceId = messages.length - 3;
        }

        // If a backend builder URL is provided, call it with the chat content
        if (builderConfig?.backendUrl) {
          logger.debug('Calling backend builder server');
          dataStream.writeData({
            type: 'progress',
            label: 'builder',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Connecting to builder server',
          } satisfies ProgressAnnotation);

          try {
            // Call the backend builder server
            const builderResponse = await fetch(builderConfig.backendUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(builderConfig.apiKey ? { Authorization: `Bearer ${builderConfig.apiKey}` } : {}),
              },
              body: JSON.stringify({
                messages,
                builderOptions: builderConfig.options || {},
              }),
            });

            if (!builderResponse.ok) {
              throw new Error(`Builder server returned status ${builderResponse.status}`);
            }

            const builderData = await builderResponse.json();

            // Add builder result to annotations
            dataStream.writeMessageAnnotation({
              type: 'contextData',
              summary: JSON.stringify(builderData),
              chatId: messages.slice(-1)?.[0]?.id || '',
            });

            dataStream.writeData({
              type: 'progress',
              label: 'builder',
              status: 'complete',
              order: progressCounter++,
              message: 'Builder server processing complete',
            } satisfies ProgressAnnotation);
          } catch (error: unknown) {
            logger.error('Error calling builder server', error);
            dataStream.writeData({
              type: 'progress',
              label: 'builder',
              status: 'in-progress',
              order: progressCounter++,
              message: `Builder server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            } satisfies ProgressAnnotation);
          }
        }

        if (filePaths.length > 0 && contextOptimization) {
          logger.debug('Generating Chat Summary');
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Analysing Request',
          } satisfies ProgressAnnotation);

          // Create a summary of the chat
          console.log(`Messages count: ${messages.length}`);

          summary = await createSummary({
            messages: [...messages],
            env: context.cloudflare?.env,
            apiKeys,
            providerSettings,
            promptId,
            contextOptimization,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'complete',
            order: progressCounter++,
            message: 'Analysis Complete',
          } satisfies ProgressAnnotation);

          dataStream.writeMessageAnnotation({
            type: 'chatSummary',
            summary,
            chatId: messages.slice(-1)?.[0]?.id,
          } as ContextAnnotation);

          /*
           * The rest of the function remains the same as in api.chat.ts
           * Update context buffer and process responses
           */
        }

        // Stream the text
        const options: StreamingOptions = {
          toolChoice: 'none',
          onFinish: async ({ finishReason, usage }) => {
            logger.debug('usage', JSON.stringify(usage));

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {
              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise((resolve) => setTimeout(resolve, 0));

              return;
            }

            // Handle length exceeded cases similar to original chat implementation
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        const result = await streamText({
          messages,
          env: context.cloudflare?.env,
          options,
          apiKeys,
          files,
          providerSettings,
          promptId,
          contextOptimization,
          contextFiles: filteredFiles,
          summary,
          messageSliceId,
        });

        result.mergeIntoDataStream(dataStream);

        // Create a readable stream for the text content
        const textStream = new ReadableStream({
          start(controller) {
            // Process each part of the stream
            (async () => {
              try {
                for await (const part of result.fullStream) {
                  let chunk = '';

                  // Extract text content based on part type
                  if ('text' in part && typeof part.text === 'string') {
                    chunk = part.text;
                  } else if ('textDelta' in part && typeof part.textDelta === 'string') {
                    chunk = part.textDelta;
                  }

                  if (chunk) {
                    // Enqueue the encoded chunk
                    controller.enqueue(encoder.encode(chunk));
                    lastChunk = chunk;
                  }
                }

                // Close the stream when done
                controller.close();
              } catch (error) {
                controller.error(error);
              }
            })();
          },
        });

        // Switch the stream to our text stream
        await stream.switchSource(textStream);

        // Stream handling complete
      },
    });

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: unknown) {
    logger.error('Error in builder endpoint', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
}
