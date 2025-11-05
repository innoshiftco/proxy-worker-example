/**
 * Proxy Worker with multi-level routing
 *
 * Mapping Structure:
 * 1. Routing: CUSTOMER:WAREHOUSE → TARGET_KEY (with fallback to CUSTOMER → TARGET_KEY)
 * 2. Endpoint: TARGET_KEY → Base URL
 * 3. Path: TARGET_KEY:SOURCE_PATH → DESTINATION_PATH
 *
 * KV Key Prefixes:
 * - route:CUSTOMER:WAREHOUSE or route:CUSTOMER → TARGET_KEY
 * - endpoint:TARGET_KEY → https://endpoint.example.com
 * - path:TARGET_KEY:/source/path → /destination/path
 */

export default {
	async fetch(request, env, ctx) {
		try {
			const url = new URL(request.url);
			const method = request.method;

			let customerId, warehouseId, requestBody;

			// Extract customerId and warehouseId based on request method
			if (method === 'POST') {
				// For POST requests, parse the JSON body
				try {
					requestBody = await request.json();
				} catch (jsonError) {
					return new Response(
						JSON.stringify({ error: 'Invalid or missing JSON body in request' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				// The data field contains a JSON-encoded string
				if (!requestBody.data) {
					return new Response(
						JSON.stringify({ error: 'Missing data field in request body' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				// Parse the nested JSON string
				try {
					const parsedData = JSON.parse(requestBody.data);
					customerId = parsedData.customerId;
					warehouseId = parsedData.warehouseId;
				} catch (parseError) {
					return new Response(
						JSON.stringify({ error: 'Invalid JSON in data field' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

			} else if (method === 'GET') {
				// For GET requests, read from query parameters
				customerId = url.searchParams.get('customerId');
				warehouseId = url.searchParams.get('warehouseId');

			} else {
				return new Response(
					JSON.stringify({ error: `Method ${method} not supported` }),
					{ status: 405, headers: { 'Content-Type': 'application/json' } }
				);
			}

			// Validate required parameters
			if (!customerId) {
				return new Response(
					JSON.stringify({
						error: 'Missing required parameter: customerId'
					}),
					{ status: 400, headers: { 'Content-Type': 'application/json' } }
				);
			}

			// Step 1: Look up target key with fallback
			// Try CUSTOMER:WAREHOUSE first, then fallback to CUSTOMER only
			let targetKey = null;

			if (warehouseId) {
				targetKey = await env.ROUTING_KV.get(`route:${customerId}:${warehouseId}`);
			}

			// Fallback to customer-level routing if warehouse-specific not found
			if (!targetKey) {
				targetKey = await env.ROUTING_KV.get(`route:${customerId}`);
			}

			if (!targetKey) {
				return new Response(
					JSON.stringify({
						error: `No routing found for customerId: ${customerId}${warehouseId ? ', warehouseId: ' + warehouseId : ''}`
					}),
					{ status: 404, headers: { 'Content-Type': 'application/json' } }
				);
			}

			// Step 2: Look up endpoint for target key
			const targetEndpoint = await env.ROUTING_KV.get(`endpoint:${targetKey}`);

			if (!targetEndpoint) {
				return new Response(
					JSON.stringify({
						error: `No endpoint found for target: ${targetKey}`
					}),
					{ status: 404, headers: { 'Content-Type': 'application/json' } }
				);
			}

			// Step 3: Look up path mapping for target key
			const sourcePath = url.pathname;
			const pathMapping = await env.ROUTING_KV.get(`path:${targetKey}:${sourcePath}`);

			// Use mapped path if exists, otherwise use original path
			const destinationPath = pathMapping || sourcePath;

			// Build target URL
			const targetUrl = new URL(destinationPath + url.search, targetEndpoint);

			// Create new request to forward
			const forwardRequest = new Request(targetUrl.toString(), {
				method: request.method,
				headers: request.headers,
				body: method === 'POST' ? JSON.stringify(requestBody) : null,
			});

			// Forward the request to target endpoint
			const response = await fetch(forwardRequest);

			// Return the response from target endpoint
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});

		} catch (error) {
			return new Response(
				JSON.stringify({
					error: 'Internal server error',
					message: error.message
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
	},
};
