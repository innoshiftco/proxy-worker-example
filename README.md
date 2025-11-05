# Proxy Worker

A Cloudflare Workers proxy that intelligently routes requests to different endpoints based on customer and warehouse identifiers, with flexible path mapping capabilities.

## Features

- **Multi-level routing**: Customer/Warehouse → Target → Endpoint + Path mapping
- **Fallback support**: Warehouse-specific routing with customer-level defaults
- **Reusable configurations**: Multiple customers can share the same target settings
- **Flexible path mapping**: Transform source paths to different destination paths per target
- **GET and POST support**: Handle both query parameters and JSON body data
- **Edge performance**: Runs on Cloudflare's global network

## Architecture

```
Request with customerId + warehouseId
    ↓
1. Lookup Routing: route:CUSTOMER:WAREHOUSE → TARGET_KEY
   (Fallback: route:CUSTOMER → TARGET_KEY)
    ↓
2. Lookup Endpoint: endpoint:TARGET_KEY → https://api.example.com
    ↓
3. Lookup Path: path:TARGET_KEY:/source → /destination (optional)
    ↓
4. Forward request to: https://api.example.com/destination
```

## Prerequisites

- [Node.js](https://nodejs.org/) 16.x or later
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (Cloudflare Workers CLI)
- Cloudflare account (free tier works)

## Installation

1. **Clone or download this repository**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Login to Cloudflare**
   ```bash
   wrangler login
   ```

## Setup

### Step 1: Create KV Namespace

Create a KV namespace to store routing configuration:

```bash
wrangler kv namespace create ROUTING_KV
```

This will output something like:
```
🌀 Creating namespace with title "proxy-worker-ROUTING_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "ROUTING_KV", id = "abc123..." }
```

**For production:**
```bash
wrangler kv namespace create ROUTING_KV --preview false
```

### Step 2: Update Configuration

Update `wrangler.jsonc` with your KV namespace ID:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "ROUTING_KV",
      "id": "YOUR_KV_NAMESPACE_ID_HERE"
    }
  ]
}
```

### Step 3: Configure Routing

Add your routing configuration to KV. The worker uses three types of mappings:

#### 3.1 Routing Mappings (Customer/Warehouse → Target)

```bash
# Replace <KV_ID> with your namespace ID from Step 1

# Warehouse-specific routing
wrangler kv key put --namespace-id=<KV_ID> "route:NESTLE:GDEC-01" "TARGET_A"
wrangler kv key put --namespace-id=<KV_ID> "route:NESTLE:GDEC-02" "TARGET_B"
wrangler kv key put --namespace-id=<KV_ID> "route:PEPSI:WAREHOUSE-01" "TARGET_C"

# Customer-level routing (fallback when warehouse not found)
wrangler kv key put --namespace-id=<KV_ID> "route:COCA_COLA" "TARGET_A"
```

#### 3.2 Endpoint Mappings (Target → Base URL)

```bash
# Define target endpoints
wrangler kv key put --namespace-id=<KV_ID> "endpoint:TARGET_A" "https://api1.example.com"
wrangler kv key put --namespace-id=<KV_ID> "endpoint:TARGET_B" "https://api2.example.com"
wrangler kv key put --namespace-id=<KV_ID> "endpoint:TARGET_C" "https://api3.example.com"
```

#### 3.3 Path Mappings (Target + Source → Destination) *Optional*

```bash
# Map source paths to destination paths for specific targets
wrangler kv key put --namespace-id=<KV_ID> "path:TARGET_A:/api/inventory" "/webhook/inventory"
wrangler kv key put --namespace-id=<KV_ID> "path:TARGET_A:/api/orders" "/webhook/orders"
wrangler kv key put --namespace-id=<KV_ID> "path:TARGET_B:/api/inventory" "/v2/stock"
```

**Note**: Path mappings are optional. If not configured, the original path is preserved.

### Step 4: Bulk Configuration (Optional)

For easier management, you can create a script to load multiple keys:

```bash
#!/bin/bash
KV_ID="your_kv_namespace_id"

# Routing mappings
wrangler kv key put --namespace-id=$KV_ID "route:NESTLE:GDEC-01" "TARGET_A"
wrangler kv key put --namespace-id=$KV_ID "route:PEPSI:WAREHOUSE-01" "TARGET_B"

# Endpoint mappings
wrangler kv key put --namespace-id=$KV_ID "endpoint:TARGET_A" "https://api1.example.com"
wrangler kv key put --namespace-id=$KV_ID "endpoint:TARGET_B" "https://api2.example.com"

# Path mappings
wrangler kv key put --namespace-id=$KV_ID "path:TARGET_A:/api/inventory" "/webhook/inventory"
```

## Deployment

### Development

Run locally with hot reload:

```bash
npm run dev
```

The worker will be available at `http://localhost:8787`

### Production

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

The deployment will output your worker URL:
```
✨ Success! Deployed to https://proxy-worker.your-subdomain.workers.dev
```

## Testing

Run the test suite:

```bash
npm test
```

Tests cover:
- POST and GET request handling
- Multi-level routing with fallback
- Path mapping
- Error handling
- Request validation

## Usage Examples

### POST Request

```bash
curl -X POST https://proxy-worker.your-subdomain.workers.dev/api/inventory \
  -H "Content-Type: application/json" \
  -d '{
    "data": "{\"customerId\":\"NESTLE\",\"warehouseId\":\"GDEC-01\",\"docNo\":\"123\",\"details\":[{\"sku\":\"ITEM001\",\"qty\":\"100\"}]}"
  }'
```

**Request Flow:**
1. Extracts `customerId=NESTLE`, `warehouseId=GDEC-01`
2. Looks up `route:NESTLE:GDEC-01` → `TARGET_A`
3. Looks up `endpoint:TARGET_A` → `https://api1.example.com`
4. Looks up `path:TARGET_A:/api/inventory` → `/webhook/inventory` (if configured)
5. Forwards POST to `https://api1.example.com/webhook/inventory`

### GET Request

```bash
curl "https://proxy-worker.your-subdomain.workers.dev/api/status?customerId=PEPSI&warehouseId=WAREHOUSE-01"
```

**Request Flow:**
1. Extracts query parameters: `customerId=PEPSI`, `warehouseId=WAREHOUSE-01`
2. Looks up `route:PEPSI:WAREHOUSE-01` → `TARGET_C`
3. Looks up `endpoint:TARGET_C` → `https://api3.example.com`
4. Forwards GET to `https://api3.example.com/api/status`

### Customer-Level Routing (No Warehouse)

```bash
curl -X POST https://proxy-worker.your-subdomain.workers.dev/api/inventory \
  -H "Content-Type: application/json" \
  -d '{
    "data": "{\"customerId\":\"COCA_COLA\",\"docNo\":\"456\"}"
  }'
```

**Request Flow:**
1. Extracts `customerId=COCA_COLA`, `warehouseId` not provided
2. Looks up `route:COCA_COLA:undefined` → not found
3. Falls back to `route:COCA_COLA` → `TARGET_A`
4. Continues with endpoint and path lookup

## Configuration Management

### View KV Keys

```bash
# List all keys
wrangler kv key list --namespace-id=<KV_ID>

# Get specific key value
wrangler kv key get --namespace-id=<KV_ID> "route:NESTLE:GDEC-01"
```

### Update Configuration

```bash
# Update routing
wrangler kv key put --namespace-id=<KV_ID> "route:NESTLE:GDEC-01" "TARGET_B"

# Update endpoint
wrangler kv key put --namespace-id=<KV_ID> "endpoint:TARGET_A" "https://new-api.example.com"

# Add new path mapping
wrangler kv key put --namespace-id=<KV_ID> "path:TARGET_A:/api/shipments" "/logistics/shipments"
```

### Delete Configuration

```bash
# Delete specific key
wrangler kv key delete --namespace-id=<KV_ID> "route:NESTLE:GDEC-01"
```

## Error Responses

| Status | Error | Cause |
|--------|-------|-------|
| 400 | Invalid or missing JSON body in request | POST request body is not valid JSON |
| 400 | Missing data field in request body | POST request missing `data` field |
| 400 | Invalid JSON in data field | `data` field contains invalid JSON string |
| 400 | Missing required parameter: customerId | No `customerId` provided |
| 404 | No routing found for customerId: X, warehouseId: Y | No routing configuration exists |
| 404 | No endpoint found for target: TARGET_X | Target has no endpoint configured |
| 405 | Method X not supported | HTTP method other than GET/POST used |
| 500 | Internal server error | Unexpected error occurred |

## Monitoring

Enable observability in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true
  }
}
```

View logs:

```bash
wrangler tail
```

## Troubleshooting

### Issue: 404 - No routing found

**Solution**: Verify routing configuration exists in KV:
```bash
wrangler kv key get --namespace-id=<KV_ID> "route:CUSTOMER:WAREHOUSE"
```

### Issue: 404 - No endpoint found for target

**Solution**: Verify endpoint configuration:
```bash
wrangler kv key get --namespace-id=<KV_ID> "endpoint:TARGET_KEY"
```

### Issue: Worker not using latest KV values

**Solution**: KV has eventual consistency. Changes may take up to 60 seconds globally.

### Issue: Request timing out

**Solution**: Check target endpoint is accessible and responding. Test directly:
```bash
curl -v https://your-target-endpoint.com
```

## Development

### Project Structure

```
proxy-worker/
├── src/
│   └── index.js          # Worker entry point with routing logic
├── test/
│   └── index.spec.js     # Test suite
├── wrangler.jsonc        # Cloudflare Workers configuration
├── vitest.config.js      # Test configuration
├── package.json          # Dependencies and scripts
├── CLAUDE.md            # AI assistant context
└── README.md            # This file
```

### Local Testing with KV

For local development, Wrangler automatically creates preview KV namespaces. Use the same setup commands with the preview namespace ID.

## Performance Considerations

- **KV Reads**: Each request performs 2-3 KV reads (routing + endpoint + optional path)
- **KV Caching**: KV values are cached at the edge, subsequent reads are fast
- **Cold Start**: First request may be slower due to worker initialization
- **Edge Deployment**: Worker runs on Cloudflare's global network close to users

## Security

- Never commit KV namespace IDs or sensitive endpoint URLs to version control
- Use `wrangler secret` for authentication tokens:
  ```bash
  wrangler secret put API_TOKEN
  ```
- Configure CORS headers on target endpoints if needed
- Use HTTPS for all target endpoints

## License

This project is private and proprietary.

## Support

For issues or questions, contact your development team.
