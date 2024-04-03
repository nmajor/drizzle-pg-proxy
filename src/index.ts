import { serve } from "@hono/node-server";
import { Client } from "pg";
import { Hono } from "hono";
import { JWTPayload, errors, jwtVerify } from "jose";

const key = new TextEncoder().encode(process.env.APP_SECRET);
const alg = "HS256";

const client = new Client(process.env.DATABASE_URL);
const app = new Hono();

type QueryBody = {
	sql: string;
	params: (string | number | boolean)[];
	method: "all" | "execute";
};

export async function verifyJwt<TPayload extends JWTPayload>(input: string) {
	try {
		const { payload } = await jwtVerify(input, key, {
			algorithms: [alg],
		});
		return payload as TPayload;
	} catch (error: unknown) {
		if (error instanceof errors.JOSEError) {
			if (error.code === "ERR_JWT_EXPIRED") {
				return null;
			}
		}
	}
}

app.post("/query", async (c) => {
	const jwt = await c.req.text();
	const body = await verifyJwt<QueryBody>(jwt);

	if (!body) {
		return new Response("Unauthorized", {
			status: 401,
		});
	}

	const { sql, params, method } = body;
	const sqlBody = sql.replace(/;/g, "");

	try {
		const result = await client.query({
			text: sqlBody,
			values: params,
			rowMode: method === "all" ? "array" : undefined,
			// biome-ignore lint/suspicious/noExplicitAny: rawMode isnt recognized by the types, but only works with it
		} as any);

		return Response.json(result.rows);
		// biome-ignore lint/suspicious/noExplicitAny: This is a runtime error, so we can't know the type of `e` ahead of time
	} catch (e: any) {
		return new Response(e.message, {
			status: 500,
		});
	}
});

app.get("/health", async () => {
	return new Response("OK", {
		status: 200,
	});
});

const port = 3030;

const start = async () => {
	// sleep for 5 seconds to wait for the database to start
	await new Promise((resolve) => setTimeout(resolve, 5000));
	await client.connect();
	console.log(`Server is starting on port ${port}`);
	serve({
		fetch: app.fetch,
		port,
	});
};

start().catch(console.error);
