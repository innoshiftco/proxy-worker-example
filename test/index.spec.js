import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import worker from '../src';

// Mock server to simulate target endpoints
const mockServer = {
	fetch: async (request) => {
		const url = new URL(request.url);
		return new Response(
			JSON.stringify({
				message: 'Success from mock server',
				path: url.pathname,
				method: request.method,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	},
};

describe('Proxy Worker', () => {
	beforeAll(async () => {
		// Set up multi-level mapping in KV
		// Routing mappings
		await env.ROUTING_KV.put('route:NESTLE:GDEC-01', 'TARGET_A');
		await env.ROUTING_KV.put('route:PEPSI:WAREHOUSE-02', 'TARGET_B');
		await env.ROUTING_KV.put('route:COCA_COLA', 'TARGET_A'); // Customer-level routing

		// Endpoint mappings
		await env.ROUTING_KV.put('endpoint:TARGET_A', 'https://httpbin.dev');
		await env.ROUTING_KV.put('endpoint:TARGET_B', 'https://httpbin.dev');

		// Path mappings (optional)
		await env.ROUTING_KV.put('path:TARGET_A:/api/inventory', '/post');
		await env.ROUTING_KV.put('path:TARGET_B:/api/orders', '/post');
	});

	afterEach(async () => {
		// Clean up any test-specific KV entries
	});

	describe('POST requests', () => {
		it('should proxy POST request with valid customerId and warehouseId', async () => {
			const requestBody = {
				data: JSON.stringify({
					customerId: 'NESTLE',
					warehouseId: 'GDEC-01',
					docNo: '123',
					details: [
						{
							adjLineNo: 'LN1',
							sku: 'IPHONE17',
							changeQty: '100.000',
						},
					],
				}),
			};

			// Use httpbin.dev's /post endpoint which exists and returns 200
			const request = new Request('http://example.com/post', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// httpbin.dev/post returns 200 for POST requests
			expect(response.status).toBe(200);
		});

		it('should return 400 when request body is empty', async () => {
			const request = new Request('http://example.com/api/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const json = await response.json();
			expect(json.error).toContain('Invalid or missing JSON body');
		});

		it('should return 400 when data field is missing', async () => {
			const request = new Request('http://example.com/api/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ foo: 'bar' }),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const json = await response.json();
			expect(json.error).toContain('Missing data field');
		});

		it('should return 400 when data field contains invalid JSON', async () => {
			const request = new Request('http://example.com/api/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ data: 'not valid json{' }),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const json = await response.json();
			expect(json.error).toContain('Invalid JSON in data field');
		});

		it('should return 400 when customerId is missing', async () => {
			const requestBody = {
				data: JSON.stringify({
					// missing customerId
					warehouseId: 'GDEC-01',
					docNo: '123',
				}),
			};

			const request = new Request('http://example.com/api/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const json = await response.json();
			expect(json.error).toContain('Missing required parameter: customerId');
		});

		it('should return 404 when no routing found for customer/warehouse', async () => {
			const requestBody = {
				data: JSON.stringify({
					customerId: 'UNKNOWN',
					warehouseId: 'UNKNOWN',
					docNo: '123',
				}),
			};

			const request = new Request('http://example.com/api/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(404);
			const json = await response.json();
			expect(json.error).toContain('No routing found');
		});

		it('should use path mapping when configured', async () => {
			const requestBody = {
				data: JSON.stringify({
					customerId: 'NESTLE',
					warehouseId: 'GDEC-01',
					docNo: '123',
				}),
			};

			// Request to /api/inventory which maps to /post for TARGET_A
			const request = new Request('http://example.com/api/inventory', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// httpbin.dev/post returns 200
			expect(response.status).toBe(200);
		});

		it('should fallback to customer-level routing when warehouse-specific not found', async () => {
			const requestBody = {
				data: JSON.stringify({
					customerId: 'COCA_COLA',
					warehouseId: 'ANY_WAREHOUSE',
					docNo: '123',
				}),
			};

			const request = new Request('http://example.com/post', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Should route to TARGET_A via customer-level mapping
			expect(response.status).toBe(200);
		});
	});

	describe('GET requests', () => {
		it('should proxy GET request with query parameters', async () => {
			// Use httpbin.dev's /get endpoint which exists and returns 200
			const request = new Request(
				'http://example.com/get?customerId=PEPSI&warehouseId=WAREHOUSE-02'
			);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// httpbin.dev/get returns 200 for GET requests
			expect(response.status).toBe(200);
		});

		it('should return 400 when customerId query parameter is missing', async () => {
			const request = new Request('http://example.com/api/inventory?warehouseId=WAREHOUSE-02');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const json = await response.json();
			expect(json.error).toContain('Missing required parameter: customerId');
		});
	});

	describe('Unsupported methods', () => {
		it('should return 405 for unsupported HTTP methods', async () => {
			const request = new Request('http://example.com/api/test', {
				method: 'DELETE',
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(405);
			const json = await response.json();
			expect(json.error).toContain('not supported');
		});
	});

	describe('Path preservation', () => {
		it('should preserve the original request path when proxying', async () => {
			const requestBody = {
				data: JSON.stringify({
					customerId: 'NESTLE',
					warehouseId: 'GDEC-01',
					docNo: '123',
				}),
			};

			// Use httpbin.dev's /post endpoint to verify path preservation
			const request = new Request('http://example.com/post', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// httpbin.dev/post returns 200 for POST requests
			expect(response.status).toBe(200);
		});
	});
});
