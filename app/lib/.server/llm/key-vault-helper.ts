import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

export async function initializeApiKeysFromKeyVault(keyVaultUrl: string): Promise<void> {
  try {
    // Create a credential using DefaultAzureCredential
    const credential = new DefaultAzureCredential();

    // Create a SecretClient to interact with Key Vault
    const secretClient = new SecretClient(keyVaultUrl, credential);

    // Fetch secrets from Key Vault
    const anthropicSecret = await secretClient.getSecret('ANTHROPIC-CLAUDE');
    const openAiSecret = await secretClient.getSecret('OPENAI-API-KEY');

    // Set environment variables
    process.env.ANTHROPIC_API_KEY = anthropicSecret.value;
    process.env.OPENAI_API_KEY = openAiSecret.value;

    console.log('Successfully loaded API keys from Azure Key Vault');
  } catch (error) {
    console.error('Failed to initialize API keys from Key Vault:', error);
    throw error;
  }
}
