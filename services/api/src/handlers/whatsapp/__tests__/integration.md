# WhatsApp Webhook Integration Test Plan

## Test Setup

1. Deploy the infrastructure:
   ```bash
   cd infra/cdk
   pnpm cdk deploy --all --context env=dev
   ```

2. Note the webhook URL from the output:
   ```
   WhatsAppWebhookUrl = https://{api-id}.execute-api.us-east-1.amazonaws.com/api/v1/whatsapp/webhook
   ```

3. Configure WhatsApp webhook secrets in AWS Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name /dev/whatsapp/verify-token \
     --secret-string "your-verify-token"
   
   aws secretsmanager create-secret \
     --name /dev/whatsapp/app-secret \
     --secret-string "your-app-secret"
   ```

## Test Cases

### 1. Webhook Verification (GET)

Test Meta's webhook verification:

```bash
curl -X GET "https://{api-id}.execute-api.us-east-1.amazonaws.com/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=your-verify-token&hub.challenge=test-challenge"
```

Expected: Returns `test-challenge` with 200 status

### 2. Invalid Verification Token (GET)

```bash
curl -X GET "https://{api-id}.execute-api.us-east-1.amazonaws.com/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test-challenge"
```

Expected: Returns 403 status

### 3. Incoming Message (POST)

```bash
# Generate signature
PAYLOAD='{"object":"whatsapp_business_account","entry":[{"id":"entry-1","changes":[{"field":"messages","value":{"messages":[{"id":"msg-123","from":"919876543210","type":"text","text":{"body":"Hello"}}]}}]}]}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your-app-secret" | sed 's/^.* //')

curl -X POST "https://{api-id}.execute-api.us-east-1.amazonaws.com/api/v1/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

Expected: Returns `{"status":"received"}` with 200 status

### 4. Verify EventBridge Event

Check CloudWatch Logs for the webhook Lambda:

```bash
aws logs tail /aws/lambda/vyapargyan-dev-whatsapp-webhook --follow
```

Expected: Log showing event published to EventBridge

### 5. Verify SQS Message

Check the SQS queue:

```bash
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/{account}/vyapargyan-dev-whatsapp-messages \
  --max-number-of-messages 1
```

Expected: Message containing the EventBridge event

### 6. Verify Worker Processing

Check CloudWatch Logs for the worker Lambda:

```bash
aws logs tail /aws/lambda/vyapargyan-dev-whatsapp-worker --follow
```

Expected: Logs showing:
- Message extracted from SQS
- Idempotency check passed
- Customer resolved/created
- Session resolved/created
- Message routed to state handler

### 7. Verify DynamoDB Records

Check for customer record:

```bash
aws dynamodb get-item \
  --table-name vyapargyan-dev-main \
  --key '{"PK":{"S":"CUSTOMER#919876543210"},"SK":{"S":"PROFILE"}}'
```

Expected: Customer record with phone number and profile

Check for session record:

```bash
aws dynamodb query \
  --table-name vyapargyan-dev-main \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"SESSION#{customer-id}"}}'
```

Expected: Session record with state = "greeting"

### 8. Verify Idempotency

Send the same message twice (same message ID):

```bash
# Send first time - should process
curl -X POST "..." -H "..." -d "$PAYLOAD"

# Send second time - should be deduplicated
curl -X POST "..." -H "..." -d "$PAYLOAD"
```

Expected: 
- First request: Full processing
- Second request: Skipped due to idempotency lock

Check worker logs for "Skipping duplicate message"

### 9. Verify TTL Cleanup

Check idempotency record has TTL:

```bash
aws dynamodb get-item \
  --table-name vyapargyan-dev-main \
  --key '{"PK":{"S":"IDEMPOTENCY#msg-123"},"SK":{"S":"LOCK"}}'
```

Expected: Record with `expiresAt` attribute set to ~60 seconds from creation

## Monitoring

### CloudWatch Metrics

- Lambda invocations
- Lambda errors
- Lambda duration
- SQS messages sent
- SQS messages received
- EventBridge events published

### CloudWatch Alarms

Set up alarms for:
- Lambda errors > 5 in 5 minutes
- SQS DLQ messages > 0
- Lambda throttles > 0

## Cleanup

```bash
cd infra/cdk
pnpm cdk destroy --all --context env=dev
```
