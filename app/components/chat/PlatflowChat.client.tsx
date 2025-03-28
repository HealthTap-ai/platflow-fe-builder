/*
 * BuilderChat component that extends Chat functionality to connect to a backend builder server
 */
import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { selectStarterTemplate, getTemplates } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import BuilderSettings from './PlatflowSettings';
import { ClientOnly } from 'remix-utils/client-only';

const logger = createScopedLogger('BuilderChat');

interface BuilderConfig {
  backendUrl: string;
  apiKey?: string;
  options?: Record<string, any>;
}

interface BuilderChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
  builderConfig?: BuilderConfig;
}

export function BuilderChat() {
  logger.debug('BuilderChat component initializing');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  const [builderConfig, setBuilderConfig] = useState<BuilderConfig>({
    backendUrl: '',
    apiKey: '',
  });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    logger.debug('BuilderChat useEffect: initialMessages changed', { count: initialMessages?.length });

    if (initialMessages && initialMessages.length > 0) {
      workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
    }
  }, [initialMessages]);

  // Load builder configuration from cookies if available
  useEffect(() => {
    logger.debug('BuilderChat useEffect: Loading builder config from cookies');

    const savedBuilderConfig = Cookies.get('builderConfig');

    if (savedBuilderConfig) {
      try {
        setBuilderConfig(JSON.parse(savedBuilderConfig));
        logger.debug('BuilderConfig loaded successfully from cookies');
      } catch (e) {
        logger.error('Failed to parse builder config from cookies', e);
      }
    } else {
      logger.debug('No builderConfig found in cookies');
    }
  }, []);

  return (
    <>
      {ready && (
        <>
          <div className="fixed top-4 right-4 z-10">
            <button
              className="flex items-center px-3 py-2 bg-bolt-accent text-white rounded-md hover:bg-bolt-accent-hover"
              onClick={() => setShowSettings(!showSettings)}
            >
              <span className="i-ph:gear mr-1" />
              Builder Settings
            </button>
            {showSettings && (
              <div className="absolute right-0 mt-2 w-96">
                <ClientOnly>
                  {() => (
                    <BuilderSettings
                      initialConfig={builderConfig}
                      onConfigChange={(config) => {
                        setBuilderConfig(config);
                        setShowSettings(false);
                      }}
                    />
                  )}
                </ClientOnly>
              </div>
            )}
          </div>
          <PlatflowChatImpl
            description={title}
            initialMessages={initialMessages || []}
            exportChat={exportChat}
            storeMessageHistory={storeMessageHistory}
            importChat={importChat}
            builderConfig={builderConfig}
          />
        </>
      )}
    </>
  );
}

export const PlatflowChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat, builderConfig }: BuilderChatProps) => {
    logger.debug('PlatflowChatImpl render', {
      descriptionLength: description?.length,
      initialMessagesCount: initialMessages?.length,
      hasConfig: !!builderConfig?.backendUrl,
    });

    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages?.length > 0 || false);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const actionAlert = useStore(workbenchStore.alert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });

    const { showChat } = useStore(chatStore);

    const [animationScope, animate] = useAnimate();
    console.log('animate', animate);

    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    // Use builder API endpoint instead of regular chat endpoint
    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
    } = useChat({
      api: '/api/builder', // Use our new builder API endpoint
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        builderConfig, // Pass the builder config to the API
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        logger.error('Request failed\n\n', e, error);
        logStore.logError('Builder Chat request failed', e, {
          component: 'BuilderChat',
          action: 'request',
          error: e.message,
        });
        toast.error(
          'There was an error processing your request: ' + (e.message ? e.message : 'No details were returned'),
        );
      },
      onFinish: (message, response) => {
        logger.debug('Chat response finished', { messageLength: message.content.length });

        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Builder Chat response completed', {
            component: 'BuilderChat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });

    useEffect(() => {
      logger.debug('PlatflowChatImpl useEffect: searchParams changed', { hasPrompt: !!searchParams.get('prompt') });

      const prompt = searchParams.get('prompt');

      if (prompt) {
        setSearchParams({});
        runAnimation();
        logger.debug('Appending prompt from URL param', { promptLength: prompt.length });
        append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
            },
          ] as any, // Type assertion to bypass compiler check
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    console.log('TEXTAREA_MAX_HEIGHT', TEXTAREA_MAX_HEIGHT);

    useEffect(() => {
      logger.debug('PlatflowChatImpl useEffect: initialMessages changed', {
        initialMessagesCount: initialMessages?.length,
      });
      chatStore.setKey('started', initialMessages?.length > 0 || false);
    }, [initialMessages]);

    useEffect(() => {
      logger.debug('PlatflowChatImpl useEffect: messages or isLoading changed', {
        messagesCount: messages.length,
        isLoading,
      });
      processSampledMessages({
        messages,
        initialMessages: initialMessages || [],
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages, initialMessages]);

    const scrollTextArea = () => {
      logger.debug('scrollTextArea called');

      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      logger.debug('abort called');
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Builder Chat response aborted', {
        component: 'BuilderChat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const runAnimation = async () => {
      logger.debug('runAnimation called', { chatStarted });

      if (!chatStarted) {
        setChatStarted(true);
        chatStore.setKey('started', true);
      }
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      logger.debug('sendMessage called', {
        hasInput: !!input?.trim(),
        hasMessageInput: !!messageInput?.trim(),
        isLoading,
      });

      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        logger.debug('sendMessage: no message content, returning');
        return;
      }

      if (isLoading) {
        logger.debug('sendMessage: isLoading, calling abort');
        abort();

        return;
      }

      // Check if builder server URL is configured
      if (!builderConfig || !builderConfig.backendUrl) {
        logger.debug('sendMessage: missing builderConfig.backendUrl');
        toast.warning('Builder server URL is not configured. Please set up the builder settings first.');

        return;
      }

      runAnimation();

      if (!chatStarted) {
        logger.debug('sendMessage: first message, chat not started yet');
        setFakeLoading(true);

        if (autoSelectTemplate) {
          logger.debug('sendMessage: attempting to select starter template');

          const { template, title } = await selectStarterTemplate({
            message: messageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
                    },
                    ...imageDataList.map((imageData) => ({
                      type: 'image',
                      image: imageData,
                    })),
                  ] as any,
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);
              reload();
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);

              setUploadedFiles([]);
              setImageDataList([]);

              resetEnhancer();

              textareaRef.current?.blur();
              setFakeLoading(false);

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: [
              {
                type: 'text',
                text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
              },
              ...imageDataList.map((imageData) => ({
                type: 'image',
                image: imageData,
              })),
            ] as any,
          },
        ]);
        reload();
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();
        textareaRef.current?.blur();
        setFakeLoading(false);

        return;
      }

      append({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
          },
          ...imageDataList.map((imageData) => ({
            type: 'image',
            image: imageData,
          })),
        ] as any,
      });

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();
      textareaRef.current?.blur();
    };

    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      logger.debug('onTextareaChange called', { inputLength: event.target.value.length });
      handleInputChange(event);
      scrollTextArea();
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    const [messageRef, scrollRef] = useSnapScroll();

    useEffect(() => {
      logger.debug('PlatflowChatImpl useEffect: loading API keys from cookies');

      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
        logger.debug('API keys loaded from cookies');
      } else {
        logger.debug('No API keys found in cookies');
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      logger.debug('handleModelChange called', { newModel });
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      logger.debug('handleProviderChange called', { newProvider: newProvider.name });
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description || 'Builder Chat'}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        data={chatData}
      />
    );
  },
);

// Helper function for processing messages
const processSampledMessages = (options: {
  messages: Message[];
  initialMessages: Message[];
  isLoading: boolean;
  parseMessages: (messages: Message[], isLoading: boolean) => void;
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}) => {
  const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
  logger.debug('processSampledMessages called', {
    messagesCount: messages.length,
    initialCount: initialMessages.length,
    isLoading,
  });

  parseMessages(messages, isLoading);

  if (messages.length > initialMessages.length) {
    logger.debug('Storing message history', { newCount: messages.length });
    storeMessageHistory(messages).catch((error) => toast.error(error.message));
  }
};
