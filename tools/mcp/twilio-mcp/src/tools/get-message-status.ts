import type { Twilio } from 'twilio';
import { z } from 'zod';

const getMessageStatusSchema = z.object({
  messageSid: z.string().min(1),
});

export async function getMessageStatusTool(client: Twilio, args: unknown) {
  const { messageSid } = getMessageStatusSchema.parse(args);

  const message = await client.messages(messageSid).fetch();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            messageSid: message.sid,
            status: message.status,
            direction: message.direction,
            from: message.from,
            to: message.to,
            body: message.body,
            dateCreated: message.dateCreated,
            dateSent: message.dateSent,
            dateUpdated: message.dateUpdated,
            errorCode: message.errorCode,
            errorMessage: message.errorMessage,
            price: message.price,
            priceUnit: message.priceUnit,
          },
          null,
          2
        ),
      },
    ],
  };
}
