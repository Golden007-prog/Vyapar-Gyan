#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import twilio from 'twilio';
import { sendMessageTool } from './tools/send-message.js';
import { getMessageHistoryTool } from './tools/get-message-history.js';
import { getMessageStatusTool } from './tools/get-message-status.js';

// Validate required environment variables
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
  console.error('Error: Missing required Twilio environment variables');
  console.error('Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER');
  console.error('Current values:');
  console.error(`  TWILIO_ACCOUNT_SID: ${TWILIO_ACCOUNT_SID || '(not set)'}`);
  console.error(`  TWILIO_AUTH_TOKEN: ${TWILIO_AUTH_TOKEN ? '***' : '(not set)'}`);
  console.error(`  TWILIO_PHONE_NUMBER: ${TWILIO_PHONE_NUMBER || '(not set)'}`);
  process.exit(1);
}

// Validate Account SID format
if (!TWILIO_ACCOUNT_SID.startsWith('AC')) {
  console.error('Error: Invalid TWILIO_ACCOUNT_SID format');
  console.error('Account SID must start with "AC"');
  console.error(`Current value: ${TWILIO_ACCOUNT_SID}`);
  console.error('');
  console.error('If you see "${TWILIO_ACCOUNT_SID}", the environment variable is not being expanded.');
  console.error('Set the actual values in your MCP config or system environment variables.');
  process.exit(1);
}

// Initialize Twilio client
let twilioClient: ReturnType<typeof twilio>;
try {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
} catch (error) {
  console.error('Error: Failed to initialize Twilio client');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// Create MCP server
const server = new Server(
  {
    name: 'twilio-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_whatsapp_message',
      description: 'Send a WhatsApp message via Twilio',
      inputSchema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Recipient phone number in E.164 format (e.g., +1234567890)',
          },
          body: {
            type: 'string',
            description: 'Message body text',
          },
          mediaUrl: {
            type: 'string',
            description: 'Optional media URL for image/video/audio',
          },
        },
        required: ['to', 'body'],
      },
    },
    {
      name: 'get_message_history',
      description: 'Retrieve WhatsApp message history for a phone number',
      inputSchema: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'Phone number in E.164 format (e.g., +1234567890)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of messages to retrieve (default: 20, max: 100)',
          },
        },
        required: ['phoneNumber'],
      },
    },
    {
      name: 'get_message_status',
      description: 'Get the delivery status of a specific message',
      inputSchema: {
        type: 'object',
        properties: {
          messageSid: {
            type: 'string',
            description: 'Twilio message SID',
          },
        },
        required: ['messageSid'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'send_whatsapp_message':
        return await sendMessageTool(twilioClient, TWILIO_PHONE_NUMBER, args);
      
      case 'get_message_history':
        return await getMessageHistoryTool(twilioClient, TWILIO_PHONE_NUMBER, args);
      
      case 'get_message_status':
        return await getMessageStatusTool(twilioClient, args);
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Twilio MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
