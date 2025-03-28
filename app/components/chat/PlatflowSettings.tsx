import { useState, useEffect } from 'react';
import Cookies from 'js-cookie';
import { toast } from 'react-toastify';

interface BuilderConfig {
  backendUrl: string;
  apiKey?: string;
  options?: Record<string, any>;
}

interface BuilderSettingsProps {
  initialConfig?: BuilderConfig;
  onConfigChange?: (config: BuilderConfig) => void;
}

export default function BuilderSettings({ initialConfig, onConfigChange }: BuilderSettingsProps) {
  const [config, setConfig] = useState<BuilderConfig>(
    initialConfig || {
      backendUrl: '',
      apiKey: '',
      options: {},
    },
  );
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [optionsText, setOptionsText] = useState('{}');

  useEffect(() => {
    if (initialConfig?.options) {
      try {
        setOptionsText(JSON.stringify(initialConfig.options, null, 2));
      } catch (e) {
        console.error('Error parsing options', e);
      }
    }
  }, [initialConfig]);

  const handleSave = () => {
    try {
      // Validate URL
      new URL(config.backendUrl);

      // Parse options if provided
      let parsedOptions = {};

      if (optionsText.trim()) {
        parsedOptions = JSON.parse(optionsText);
      }

      const newConfig = {
        ...config,
        options: parsedOptions,
      };

      // Save to cookies
      Cookies.set('builderConfig', JSON.stringify(newConfig), { expires: 30 });

      // Notify parent component
      if (onConfigChange) {
        onConfigChange(newConfig);
      }

      toast.success('Builder settings saved');
    } catch (e: unknown) {
      console.error('Error saving builder settings', e);
      toast.error('Error saving settings: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
  };

  return (
    <div className="p-4 bg-bolt-background-subtle rounded-md">
      <h3 className="text-lg font-semibold mb-4">Builder Server Settings</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="backendUrl">
            Server URL
          </label>
          <input
            id="backendUrl"
            type="text"
            className="w-full p-2 border border-bolt-border rounded-md"
            value={config.backendUrl}
            onChange={(e) => setConfig({ ...config, backendUrl: e.target.value })}
            placeholder="https://your-builder-server.example.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="apiKey">
            API Key (optional)
          </label>
          <input
            id="apiKey"
            type="password"
            className="w-full p-2 border border-bolt-border rounded-md"
            value={config.apiKey || ''}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value || undefined })}
            placeholder="Your API key"
          />
        </div>

        <div>
          <button
            type="button"
            className="flex items-center text-sm font-medium text-bolt-text-subtle"
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
          >
            <span className={`mr-1 i-ph:caret-${isAdvancedOpen ? 'down' : 'right'}`} />
            Advanced Options
          </button>

          {isAdvancedOpen && (
            <div className="mt-2">
              <label className="block text-sm font-medium mb-1" htmlFor="options">
                Additional Options (JSON)
              </label>
              <textarea
                id="options"
                className="w-full p-2 border border-bolt-border rounded-md font-mono text-sm h-32"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="{}"
              />
            </div>
          )}
        </div>

        <div className="pt-2">
          <button
            type="button"
            className="px-4 py-2 bg-bolt-accent text-white rounded-md hover:bg-bolt-accent-hover"
            onClick={handleSave}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
