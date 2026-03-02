import type { Twilio } from 'twilio';
import { z } from 'zod';

const getMessageHistorySchema = z.object({
  phoneNumber: z.string().min(1),
  limit: z.number().min(1).max(100).default(20),
});

export async function getMessageHistoryTool(
  client: Twilio,
  fromNumber: string,
  args: unknown
) {
  const { phoneNumber, limit } = getMessageHistorySchema.parse(args);

  const messages = await client.messages.list({
    from: `whatsapp:${fromNumber}`,
    to: `whatsapp:${phoneNumber}`,
    limit,
  });

  const formattedMessages = messages.map((msg) => ({
    messageSid: msg.sid,
    status: msg.status,
    direction: msg.direction,
    from: msg.from,
    to: msg.to,
    body: msg.body,
    dateCreated: msg.dateCreated,
    dateSent: msg.dateSent,
    errorCode: msg.errorCode,
    errorMessage: msg.errorMessage,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            phoneNumber,
            messageCount: formattedMessages.length,
            messages: formattedMessages,
          },
          null,
          2
        ),
      },
    ],
  };
}
