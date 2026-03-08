# Bedrock Seller Copilot - Converse API Flow

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Seller WhatsApp Message                       │
│              "Update Amul Butter price to 290"                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              handleSellerWhatsAppCommand()                       │
│  • Extract user context (sellerId, message)                      │
│  • Call converseWithTools()                                      │
│  • Handle errors gracefully                                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    converseWithTools()                           │
│                   Multi-Turn Conversation Loop                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Loop Counter  │
                    │  (Max 5 loops) │
                    └────────┬───────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Bedrock ConverseCommand                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Input:                                                     │  │
│  │ • Model: anthropic.claude-3-haiku-20240307-v1:0          │  │
│  │ • System Prompt: "You are VyaparGyan Assistant..."       │  │
│  │ • User Message: "Update Amul Butter price to 290"        │  │
│  │ • Tools: [updateProductPrice, checkInventory]            │  │
│  │ • Conversation History: [previous turns]                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Claude 3 Haiku Response                       │
│                   Check stopReason                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
┌─────────────────────┐         ┌─────────────────────┐
│  stopReason:        │         │  stopReason:        │
│  "end_turn"         │         │  "tool_use"         │
└──────────┬──────────┘         └──────────┬──────────┘
           │                               │
           │                               ▼
           │                    ┌─────────────────────┐
           │                    │  Extract toolUse    │
           │                    │  • toolName         │
           │                    │  • toolInput        │
           │                    │  • toolUseId        │
           │                    └──────────┬──────────┘
           │                               │
           │                               ▼
           │                    ┌─────────────────────┐
           │                    │  Route to Handler   │
           │                    └──────────┬──────────┘
           │                               │
           │              ┌────────────────┴────────────────┐
           │              │                                 │
           │              ▼                                 ▼
           │   ┌──────────────────────┐      ┌──────────────────────┐
           │   │ handleUpdatePrice()  │      │ handleCheckInventory()│
           │   │                      │      │                      │
           │   │ 1. Query DynamoDB    │      │ 1. Query DynamoDB    │
           │   │    GSI1: SELLER#id   │      │    GSI1: SELLER#id   │
           │   │    Filter: name      │      │    Filter: name      │
           │   │                      │      │                      │
           │   │ 2. Update price      │      │ 2. Return stock      │
           │   │    SET price = X     │      │    and price         │
           │   │                      │      │                      │
           │   │ 3. Return result     │      │ 3. Return result     │
           │   └──────────┬───────────┘      └──────────┬───────────┘
           │              │                             │
           │              └────────────┬────────────────┘
           │                           │
           │                           ▼
           │              ┌─────────────────────────┐
           │              │  Tool Result            │
           │              │  {                      │
           │              │    success: true,       │
           │              │    productName: "...",  │
           │              │    oldPrice: 250,       │
           │              │    newPrice: 290,       │
           │              │    message: "..."       │
           │              │  }                      │
           │              └──────────┬──────────────┘
           │                         │
           │                         ▼
           │              ┌─────────────────────────┐
           │              │ Add to Conversation:    │
           │              │ • Assistant's toolUse   │
           │              │ • User's toolResult     │
           │              └──────────┬──────────────┘
           │                         │
           │                         ▼
           │              ┌─────────────────────────┐
           │              │  Loop Back to Bedrock   │
           │              │  (Get final response)   │
           │              └──────────┬──────────────┘
           │                         │
           │                         └──────┐
           │                                │
           ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Extract Text Response                         │
│  "I've updated the Amul Butter 500g price from ₹250 to ₹290!"  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Return to Worker                              │
│              Send response via Twilio WhatsApp                   │
└─────────────────────────────────────────────────────────────────┘
```

## Detailed Converse Loop Flow

### Iteration 1: Initial Request

```typescript
// Conversation History
conversationHistory = [
  { text: "Update Amul Butter price to 290" }
]

// Send to Bedrock
ConverseCommand({
  modelId: "anthropic.claude-3-haiku-20240307-v1:0",
  messages: [
    {
      role: "user",
      content: conversationHistory
    }
  ],
  system: [{ text: SYSTEM_PROMPT }],
  toolConfig: { tools: SELLER_TOOLS }
})

// Response from Claude
{
  stopReason: "tool_use",
  output: {
    message: {
      content: [
        {
          toolUse: {
            toolUseId: "tooluse_abc123",
            name: "updateProductPrice",
            input: {
              productName: "Amul Butter",
              newPrice: 290
            }
          }
        }
      ]
    }
  }
}
```

### Iteration 2: Tool Execution and Result

```typescript
// Execute Tool
const toolResult = await handleUpdatePrice(
  "seller-123",
  "Amul Butter",
  290
);

// Tool Result
{
  success: true,
  productName: "Amul Butter 500g",
  oldPrice: 250,
  newPrice: 290,
  message: "Successfully updated Amul Butter 500g price from ₹250 to ₹290"
}

// Update Conversation History
conversationHistory = [
  { text: "Update Amul Butter price to 290" },
  {
    toolUse: {
      toolUseId: "tooluse_abc123",
      name: "updateProductPrice",
      input: { productName: "Amul Butter", newPrice: 290 }
    }
  },
  {
    toolResult: {
      toolUseId: "tooluse_abc123",
      content: [
        {
          json: {
            success: true,
            productName: "Amul Butter 500g",
            oldPrice: 250,
            newPrice: 290,
            message: "Successfully updated..."
          }
        }
      ]
    }
  }
]

// Send to Bedrock Again
ConverseCommand({
  modelId: "anthropic.claude-3-haiku-20240307-v1:0",
  messages: [
    {
      role: "user",
      content: conversationHistory
    }
  ],
  system: [{ text: SYSTEM_PROMPT }],
  toolConfig: { tools: SELLER_TOOLS }
})

// Final Response from Claude
{
  stopReason: "end_turn",
  output: {
    message: {
      content: [
        {
          text: "I've updated the Amul Butter 500g price from ₹250 to ₹290! ✅"
        }
      ]
    }
  }
}
```

## Tool Execution Details

### updateProductPrice Flow

```
Input: { productName: "Amul Butter", newPrice: 290 }
    ↓
┌─────────────────────────────────────────┐
│  Query DynamoDB (GSI1)                  │
│  GSI1PK = "SELLER#seller-123"           │
│  Filter: contains(name, "Amul Butter")  │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Result: Amul Butter 500g               │
│  • id: prod-123                         │
│  • price: 250 (old)                     │
│  • stockQuantity: 45                    │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Update DynamoDB                        │
│  PK: "PRODUCT#prod-123"                 │
│  SK: "METADATA"                         │
│  SET price = 290                        │
│  SET updatedAt = "2024-01-15T..."       │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Return Success                         │
│  {                                      │
│    success: true,                       │
│    productName: "Amul Butter 500g",     │
│    oldPrice: 250,                       │
│    newPrice: 290,                       │
│    message: "Successfully updated..."   │
│  }                                      │
└─────────────────────────────────────────┘
```

### checkInventory Flow

```
Input: { productName: "Tata Salt" }
    ↓
┌─────────────────────────────────────────┐
│  Query DynamoDB (GSI1)                  │
│  GSI1PK = "SELLER#seller-123"           │
│  Filter: contains(name, "Tata Salt")    │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Result: Tata Salt 1kg                  │
│  • id: prod-456                         │
│  • price: 45                            │
│  • stockQuantity: 120                   │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Return Success                         │
│  {                                      │
│    success: true,                       │
│    productName: "Tata Salt 1kg",        │
│    stockQuantity: 120,                  │
│    price: 45,                           │
│    message: "Tata Salt 1kg: 120..."     │
│  }                                      │
└─────────────────────────────────────────┘
```

## Error Handling Paths

### Product Not Found

```
User: "Update XYZ Product to 100"
    ↓
Claude: tool_use → updateProductPrice
    ↓
DynamoDB Query: No results
    ↓
Tool Result: {
  success: false,
  message: "Product 'XYZ Product' not found..."
}
    ↓
Claude: "I couldn't find 'XYZ Product' in your inventory. 
         Please check the product name and try again."
```

### DynamoDB Error

```
User: "Check Amul Butter"
    ↓
Claude: tool_use → checkInventory
    ↓
DynamoDB Query: Throws error
    ↓
Catch Error: {
  success: false,
  message: "Failed to check inventory. Please try again.",
  error: "AccessDeniedException: ..."
}
    ↓
Claude: "I encountered an issue checking your inventory. 
         Please try again in a moment."
```

### Bedrock API Error

```
User: "Update price to 290"
    ↓
Bedrock API: Throws error (throttling, timeout, etc.)
    ↓
Catch Error in handleSellerWhatsAppCommand()
    ↓
Return: "Sorry, I encountered an error processing your request. 
         Please try again or contact support if the issue persists."
```

## Conversation State Management

### Single-Turn (No Tool Use)

```
Turn 1:
User: "Hello"
Claude: "Hi! I'm your VyaparGyan assistant. How can I help you today?"
[end_turn - no tool use]
```

### Single-Turn (With Tool Use)

```
Turn 1:
User: "Check Amul Butter stock"
Claude: [tool_use] → checkInventory

Turn 2 (automatic):
Tool Result: { success: true, stockQuantity: 45, price: 290 }
Claude: "You have 45 units of Amul Butter 500g in stock at ₹290 each."
[end_turn]
```

### Multi-Turn (Context Maintained)

```
Turn 1:
User: "Check Amul Butter"
Claude: [tool_use] → checkInventory
Tool Result: { stockQuantity: 45, price: 290 }
Claude: "You have 45 units at ₹290 each."

Turn 2:
User: "Make it 300"
Claude: [tool_use] → updateProductPrice (infers "Amul Butter" from context)
Tool Result: { success: true, oldPrice: 290, newPrice: 300 }
Claude: "I've updated the price to ₹300!"
```

Note: Current implementation doesn't persist context across separate WhatsApp messages. Each message starts a new conversation. Future enhancement needed for cross-message context.

## Performance Optimization Opportunities

### 1. Parallel Tool Execution

```typescript
// Current: Sequential
const result1 = await handleCheckInventory(...);
const result2 = await handleUpdatePrice(...);

// Future: Parallel (if Claude requests multiple tools)
const [result1, result2] = await Promise.all([
  handleCheckInventory(...),
  handleUpdatePrice(...)
]);
```

### 2. Product Name Caching

```typescript
// Cache frequently queried products
const productCache = new Map<string, Product>();

async function handleCheckInventory(sellerId, productName) {
  const cacheKey = `${sellerId}:${productName}`;
  if (productCache.has(cacheKey)) {
    return productCache.get(cacheKey);
  }
  // ... query DynamoDB
  productCache.set(cacheKey, result);
  return result;
}
```

### 3. Bedrock Response Streaming

```typescript
// Future: Stream responses for faster UX
const stream = await bedrockClient.send(
  new ConverseStreamCommand(input)
);

for await (const chunk of stream) {
  // Send partial responses to user
}
```

---

**Document Version**: 1.0
**Last Updated**: 2026-03-07
**Status**: Implementation Complete
