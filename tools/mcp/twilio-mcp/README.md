# Twilio MCP Server

MCP server for Twilio WhatsApp messaging operations. Provides tools for sending messages, retrieving message history, and checking message delivery status.

## Features

- Send WhatsApp messages via Twilio
- Retrieve message history for a phone number
- Check message delivery status
- Support for text and media messages

## Installation

```bash
cd tools/mcp/twilio-mcp
pnpm install
pnpm build
```

## Configuration

Set the following environment variables:

- `TWILIO_ACCOUNT_SID` - Your Twilio Account SID
- `TWILIO_AUTH_TOKEN` - Your Twilio Auth Token
- `TWILIO_PHONE_NUMBER` - Your Twilio WhatsApp-enabled phone number (E.164 format)

## MCP Configuration

Add to your `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "twilio": {
      "command": "node",
      "args": ["./tools/mcp/twilio-mcp/dist/index.js"],
      "env": {
        "TWILIO_ACCOUNT_SID": "your-account-sid",
        "TWILIO_AUTH_TOKEN": "your-auth-token",
        "TWILIO_PHONE_NUMBER": "+1234567890"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Available Tools

### send_whatsapp_message

Send a WhatsApp message via Twilio.

**Parameters:**
- `to` (string, required): Recipient phone number in E.164 format (e.g., +1234567890)
- `body` (string, required): Message body text
- `mediaUrl` (string, optional): URL for image/video/audio attachment

**Example:**
```json
{
  "to": "+919876543210",
  "body": "Hello from Twilio!",
  "mediaUrl": "https://example.com/image.jpg"
}
```

### get_message_history

Retrieve WhatsApp message history for a phone number.

**Parameters:**
- `phoneNumber` (string, required): Phone number in E.164 format
- `limit` (number, optional): Maximum messages to retrieve (default: 20, max: 100)

**Example:**
```json
{
  "phoneNumber": "+919876543210",
  "limit": 50
}
```

### get_message_status

Get the delivery status of a specific message.

**Parameters:**
- `messageSid` (string, required): Twilio message SID

**Example:**
```json
{
  "messageSid": "SM1234567890abcdef"
}
```

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Type check
pnpm typecheck
```

## Message Status Values

Twilio message statuses:
- `queued` - Message queued for sending
- `sending` - Message is being sent
- `sent` - Message sent to Twilio's servers
- `delivered` - Message delivered to recipient
- `undelivered` - Message failed to deliver
- `failed` - Message failed to send
- `read` - Message was read by recipient (if read receipts enabled)

## Security Notes

- Never commit credentials to version control
- Use environment variables or AWS Secrets Manager for credentials
- Restrict Twilio API permissions to minimum required scope
- Monitor usage and set up alerts for unusual activity
