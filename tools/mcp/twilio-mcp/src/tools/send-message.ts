import type { Twilio } from 'twilio';
import { z } from 'zod';

const sendMessageSchema = z.object({
  to: z.string().min(1),
  body: z.string().min(1),
  mediaUrl: z.string().url().optional(),
});

export async function sendMessageTool(
  client: Twilio,
  fromNumber: string,
  args: unknown
) {
  const { to, body, mediaUrl } = sendMessageSchema.parse(args);

  const messageOptions: any = {
    from: `whatsapp:${fromNumber}`,
    to: `whatsapp:${to}`,
    body,
  };

  if (mediaUrl) {
    messageOptions.mediaUrl = [mediaUrl];
  }

  const message = await client.messages.create(messageOptions);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            messageSid: message.sid,
            status: message.status,
            to: message.to,
            from: message.from,
            body: message.body,
            dateCreated: message.dateCreated,
          },
          null,
          2
        ),
      },
    ],
  };
}
