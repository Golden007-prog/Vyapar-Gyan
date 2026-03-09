import { getConfig, clearConfigCache, Config, getVoicePipelineConfig } from './config';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';

// Create mocks for AWS SDK clients
const ssmMock = mockClient(SSMClient);
const secretsMock = mockClient(SecretsManagerClient);

describe('Configuration Loader', () => {
  // Store original environment variables
  const originalEnv = process.env;
  
  beforeEach(() => {
    // Reset mocks
    ssmMock.reset();
    secretsMock.reset();
    
    // Clear config cache before each test
    clearConfigCache();
    
    // Reset environment variables
    process.env = { ...originalEnv };
    
    // Set up base environment variables
    process.env.ENVIRONMENT = 'dev';
    process.env.AWS_REGION = 'us-east-1';
    process.env.TABLE_NAME = 'vyapargyan-dev-table';
    process.env.EVENT_BUS_NAME = 'vyapargyan-dev-events';
    process.env.USER_POOL_ID = 'us-east-1_test123';
    process.env.USER_POOL_CLIENT_ID = 'test-client-id';
    process.env.PRODUCT_IMAGES_BUCKET = 'vyapargyan-dev-images';
    process.env.DOCUMENTS_BUCKET = 'vyapargyan-dev-documents';
    process.env.LOG_LEVEL = 'info';
  });
  
  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });
  
  describe('Successful configuration loading', () => {
    beforeEach(() => {
      // Mock SSM Parameter Store responses
      ssmMock.on(GetParameterCommand, {
        Name: '/dev/twilio/phone-number'
      }).resolves({
        Parameter: { Value: '+1234567890' }
      });
      
      ssmMock.on(GetParameterCommand, {
        Name: '/dev/razorpay/key-id'
      }).resolves({
        Parameter: { Value: 'rzp_test_key123' }
      });
      
      // Mock Secrets Manager responses
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/twilio/account-sid'
      }).resolves({
        SecretString: 'AC1234567890abcdef'
      });
      
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/twilio/auth-token'
      }).resolves({
        SecretString: 'twilio-auth-token-secret'
      });
      
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/razorpay/key-secret'
      }).resolves({
        SecretString: 'razorpay-secret-key'
      });
      
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/razorpay/webhook-secret'
      }).resolves({
        SecretString: 'razorpay-webhook-secret'
      });
      
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/gemini/api-key'
      }).resolves({
        SecretString: 'gemini-api-key-secret'
      });
      
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/grok/api-key'
      }).resolves({
        SecretString: 'grok-api-key-secret'
      });
    });
    
    it('should load and validate configuration successfully', async () => {
      const config = await getConfig();
      
      expect(config).toBeDefined();
      expect(config.environment).toBe('dev');
      expect(config.region).toBe('us-east-1');
      expect(config.tableName).toBe('vyapargyan-dev-table');
      expect(config.eventBusName).toBe('vyapargyan-dev-events');
      expect(config.userPoolId).toBe('us-east-1_test123');
      expect(config.twilioAccountSid).toBe('AC1234567890abcdef');
      expect(config.twilioAuthToken).toBe('twilio-auth-token-secret');
      expect(config.twilioPhoneNumber).toBe('+1234567890');
      expect(config.razorpayKeyId).toBe('rzp_test_key123');
      expect(config.razorpayKeySecret).toBe('razorpay-secret-key');
      expect(config.geminiApiKey).toBe('gemini-api-key-secret');
      expect(config.grokApiKey).toBe('grok-api-key-secret');
    });
    
    it('should cache configuration after first load', async () => {
      // First call
      const config1 = await getConfig();
      
      // Second call should return cached config without calling AWS
      const config2 = await getConfig();
      
      expect(config1).toBe(config2); // Same object reference
      
      // Verify AWS clients were only called once
      expect(ssmMock.calls().length).toBe(2); // Two SSM parameters
      expect(secretsMock.calls().length).toBe(6); // Six secrets
    });
    
    it('should use default log level if not specified', async () => {
      delete process.env.LOG_LEVEL;
      
      const config = await getConfig();
      
      expect(config.logLevel).toBe('info');
    });
    
    it('should use custom log level if specified', async () => {
      process.env.LOG_LEVEL = 'debug';
      
      const config = await getConfig();
      
      expect(config.logLevel).toBe('debug');
    });
    
    it('should use default AWS region if not specified', async () => {
      delete process.env.AWS_REGION;
      
      const config = await getConfig();
      
      expect(config.region).toBe('us-east-1');
    });
  });
  
  describe('Environment-specific configuration', () => {
    beforeEach(() => {
      // Mock responses for all environments
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
    });
    
    it('should load dev environment configuration', async () => {
      process.env.ENVIRONMENT = 'dev';
      
      const config = await getConfig();
      
      expect(config.environment).toBe('dev');
    });
    
    it('should load staging environment configuration', async () => {
      process.env.ENVIRONMENT = 'staging';
      
      const config = await getConfig();
      
      expect(config.environment).toBe('staging');
    });
    
    it('should load prod environment configuration', async () => {
      process.env.ENVIRONMENT = 'prod';
      
      const config = await getConfig();
      
      expect(config.environment).toBe('prod');
    });
  });
  
  describe('Error handling', () => {
    it('should throw error if ENVIRONMENT is missing', async () => {
      delete process.env.ENVIRONMENT;
      
      await expect(getConfig()).rejects.toThrow('ENVIRONMENT environment variable is required');
    });
    
    it('should throw error if ENVIRONMENT is invalid', async () => {
      process.env.ENVIRONMENT = 'invalid';
      
      await expect(getConfig()).rejects.toThrow('Invalid ENVIRONMENT value: invalid');
    });
    
    it('should throw error if required environment variable is missing', async () => {
      delete process.env.TABLE_NAME;
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await expect(getConfig()).rejects.toThrow('Configuration validation failed');
    });
    
    it('should throw error if SSM parameter is not found', async () => {
      // Mock secrets to succeed so we reach the SSM call
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      // Default SSM succeeds, but phone-number specifically fails
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      ssmMock.on(GetParameterCommand, {
        Name: '/dev/twilio/phone-number'
      }).rejects(new Error('ParameterNotFound'));
      
      await expect(getConfig()).rejects.toThrow('Failed to get parameter /dev/twilio/phone-number');
    });
    
    it('should throw error if SSM parameter has no value', async () => {
      // Mock secrets to succeed so we reach the SSM call
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      // Default SSM succeeds, but phone-number specifically returns empty
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      ssmMock.on(GetParameterCommand, {
        Name: '/dev/twilio/phone-number'
      }).resolves({
        Parameter: {}
      });
      
      await expect(getConfig()).rejects.toThrow('Parameter /dev/twilio/phone-number not found or has no value');
    });
    
    it('should throw error if secret is not found', async () => {
      // Mock SSM to succeed
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      
      // Mock Secrets Manager to fail
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/twilio/account-sid'
      }).rejects(new Error('ResourceNotFoundException'));
      
      await expect(getConfig()).rejects.toThrow('Failed to get secret /dev/twilio/account-sid');
    });
    
    it('should throw error if secret has no value', async () => {
      // Mock SSM to succeed
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      
      // Mock Secrets Manager to return empty
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/twilio/account-sid'
      }).resolves({});
      
      await expect(getConfig()).rejects.toThrow('Secret /dev/twilio/account-sid not found or has no value');
    });
  });
  
  describe('Configuration caching', () => {
    beforeEach(() => {
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
    });
    
    it('should clear cache when clearConfigCache is called', async () => {
      // First load
      await getConfig();
      
      // Clear cache
      clearConfigCache();
      
      // Second load should call AWS again
      await getConfig();
      
      // Verify AWS clients were called twice
      expect(ssmMock.calls().length).toBe(4); // 2 parameters × 2 loads
      expect(secretsMock.calls().length).toBe(12); // 6 secrets × 2 loads
    });
  });
  
  describe('Environment-specific secret paths', () => {
    it('should use correct secret paths for dev environment', async () => {
      process.env.ENVIRONMENT = 'dev';
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await getConfig();
      
      // Verify correct secret paths were used
      const secretCalls = secretsMock.calls();
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/dev/twilio/account-sid'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/dev/twilio/auth-token'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/dev/razorpay/key-secret'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/dev/gemini/api-key'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/dev/grok/api-key'
      )).toBe(true);
    });
    
    it('should use correct secret paths for staging environment', async () => {
      process.env.ENVIRONMENT = 'staging';
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await getConfig();
      
      // Verify correct secret paths were used
      const secretCalls = secretsMock.calls();
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/staging/twilio/account-sid'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/staging/twilio/auth-token'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/staging/razorpay/key-secret'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/staging/gemini/api-key'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/staging/grok/api-key'
      )).toBe(true);
    });
    
    it('should use correct secret paths for prod environment', async () => {
      process.env.ENVIRONMENT = 'prod';
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await getConfig();
      
      // Verify correct secret paths were used
      const secretCalls = secretsMock.calls();
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/prod/twilio/account-sid'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/prod/twilio/auth-token'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/prod/razorpay/key-secret'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/prod/gemini/api-key'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/prod/grok/api-key'
      )).toBe(true);
    });
  });

  describe('Environment variable fallback (local dev)', () => {
    it('should use env vars instead of AWS when available', async () => {
      // Set all secrets as env vars — no AWS calls needed for secrets
      process.env.TWILIO_ACCOUNT_SID = 'AC-env-sid';
      process.env.TWILIO_AUTH_TOKEN = 'env-auth-token';
      process.env.TWILIO_PHONE_NUMBER = '+19999999999';
      process.env.RAZORPAY_KEY_ID = 'rzp_env_key';
      process.env.RAZORPAY_KEY_SECRET = 'rzp_env_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_env_webhook';
      process.env.GEMINI_API_KEY = 'gemini-env-key';
      process.env.GROK_API_KEY = 'grok-env-key';

      const config = await getConfig();

      expect(config.twilioAccountSid).toBe('AC-env-sid');
      expect(config.twilioAuthToken).toBe('env-auth-token');
      expect(config.twilioPhoneNumber).toBe('+19999999999');
      expect(config.geminiApiKey).toBe('gemini-env-key');
      expect(config.grokApiKey).toBe('grok-env-key');

      // No AWS calls should have been made
      expect(ssmMock.calls().length).toBe(0);
      expect(secretsMock.calls().length).toBe(0);
    });

    it('should mix env vars and AWS fallback', async () => {
      // Only Gemini and Grok from env, rest from AWS
      process.env.GEMINI_API_KEY = 'gemini-local';
      process.env.GROK_API_KEY = 'grok-local';

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'ssm-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'aws-secret'
      });

      const config = await getConfig();

      expect(config.geminiApiKey).toBe('gemini-local');
      expect(config.grokApiKey).toBe('grok-local');
      expect(config.twilioAccountSid).toBe('aws-secret');

      // Gemini and Grok should NOT have triggered AWS calls
      const secretCalls = secretsMock.calls();
      expect(secretCalls.some(call =>
        call.args[0].input.SecretId === '/dev/gemini/api-key'
      )).toBe(false);
      expect(secretCalls.some(call =>
        call.args[0].input.SecretId === '/dev/grok/api-key'
      )).toBe(false);
    });

    it('should not let Twilio failure block Gemini when using env vars', async () => {
      // Gemini from env, Twilio from AWS but AWS fails
      process.env.GEMINI_API_KEY = 'gemini-local';
      process.env.GROK_API_KEY = 'grok-local';
      process.env.TWILIO_ACCOUNT_SID = 'AC-local';
      process.env.TWILIO_AUTH_TOKEN = 'local-token';
      process.env.TWILIO_PHONE_NUMBER = '+10000000000';
      process.env.RAZORPAY_KEY_ID = 'rzp_local';
      process.env.RAZORPAY_KEY_SECRET = 'rzp_local_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_local_webhook';

      // No AWS mocks needed — all from env
      const config = await getConfig();

      expect(config.geminiApiKey).toBe('gemini-local');
      expect(config.twilioAccountSid).toBe('AC-local');
    });
  });

  describe('getVoicePipelineConfig', () => {
    it('should return voice-relevant keys from cached full config', async () => {
      // Set all env vars so full config loads without AWS
      process.env.TWILIO_ACCOUNT_SID = 'AC-voice-sid';
      process.env.TWILIO_AUTH_TOKEN = 'voice-auth';
      process.env.TWILIO_PHONE_NUMBER = '+18888888888';
      process.env.RAZORPAY_KEY_ID = 'rzp_v';
      process.env.RAZORPAY_KEY_SECRET = 'rzp_vs';
      process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_vw';
      process.env.GEMINI_API_KEY = 'gemini-voice';
      process.env.GROK_API_KEY = 'grok-voice';

      // Prime the cache
      await getConfig();

      const voiceConfig = await getVoicePipelineConfig();

      expect(voiceConfig.geminiApiKey).toBe('gemini-voice');
      expect(voiceConfig.twilioAccountSid).toBe('AC-voice-sid');
      expect(voiceConfig.twilioAuthToken).toBe('voice-auth');
      expect(voiceConfig.twilioPhoneNumber).toBe('+18888888888');
      expect(voiceConfig.productImagesBucket).toBe('vyapargyan-dev-images');
    });

    it('should load only voice keys when full config is not cached', async () => {
      // Only voice-relevant env vars — Razorpay/Grok missing
      process.env.GEMINI_API_KEY = 'gemini-isolated';
      process.env.TWILIO_ACCOUNT_SID = 'AC-isolated';
      process.env.TWILIO_AUTH_TOKEN = 'isolated-auth';
      process.env.TWILIO_PHONE_NUMBER = '+17777777777';

      // Do NOT call getConfig() — cache is empty
      const voiceConfig = await getVoicePipelineConfig();

      expect(voiceConfig.geminiApiKey).toBe('gemini-isolated');
      expect(voiceConfig.twilioAccountSid).toBe('AC-isolated');

      // No AWS calls should have been made
      expect(ssmMock.calls().length).toBe(0);
      expect(secretsMock.calls().length).toBe(0);
    });

    it('should fail with clear error when Gemini key is missing', async () => {
      // No GEMINI_API_KEY env var, and AWS fails
      process.env.TWILIO_ACCOUNT_SID = 'AC-ok';
      process.env.TWILIO_AUTH_TOKEN = 'ok-auth';
      process.env.TWILIO_PHONE_NUMBER = '+16666666666';

      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/gemini/api-key'
      }).rejects(new Error('ResourceNotFoundException'));

      await expect(getVoicePipelineConfig()).rejects.toThrow('geminiApiKey');
    });
  });
});
