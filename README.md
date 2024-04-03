![Docker Image Size](https://img.shields.io/docker/image-size/nmajor/drizzle-pg-proxy)

# Drizzle Pg Proxy

Simple implementation of Drizzle HTTP Proxy for postgres as a standalone service. It uses [hono](https://hono.dev/) as the http server and implements the `/query` endpoint to execute queries on a postgres database as show in the [drizzle docs](https://orm.drizzle.team/docs/get-started-postgresql#http-proxy). It also uses expects all queries to be signed with a JWT token to ensure that only authorized sources can execute queries.

Running the 

# Usage

You need an `APP_SECRET` key that is used in both your drizzle app code as well as the proxy service. This key is used to sign the JWT that is sent to the proxy service and the proxy service uses the same key to verify the JWT before executing the queries.

### Generating an APP_SECRET

You can generate an `APP_SECRET` by running the following command:

```bash
openssl rand -hex 64

# Example output: 5af18615c9762d848ec19241a705c6816cfc0392dd80cae2f54ec2f9b0f2fd36db37ae88fdb752ed6b991e12f65214ada08528de6a85712639586c7cc3c31808
```

Then you can use the `db` object to query your database as you would with drizzle.

### Deploying the docker container

The docker container requires 2 variables to be set:

- `APP_SECRET`: The secret key used to sign the JWT
- `DATABASE_URL`: The postgres connection string

### Deploying on Railway

This template can easily be deployed with a linked postgresql database on Railway:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/yvPIKJ?referralCode=-NuOAq)

The template will automatically link the proxy service with the postgres database and set the `DATABASE_URL` environment variable. You will need to set the `APP_SECRET` environment variable manually.

After deploying on Railway you can use the public HTTP endpoint that Railway generates and set it to the `DATABASE_PROXY` for the drizzle code example below. 

### Usage in Drizzle

In your app using drizzle, you need to follow the postgres http proxy connection setup as described in the [drizzle docs](https://orm.drizzle.team/docs/get-started-postgresql#http-proxy).

Here is a modified setup with the JWT signing as well as some bonus date parsing:

```typescript
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "./schemas";

import { JWTPayload, SignJWT } from "jose";

const APP_SECRET = process.env.APP_SECRET
const DATABASE_PROXY = process.env.DATABASE_PROXY // The URL of the proxy service

const key = new TextEncoder().encode();
const alg = "HS256";

export async function signJwt<TPayload extends JWTPayload>(
	payload: TPayload,
	options?: { expires?: Date | string },
) {
	return await new SignJWT(payload)
		.setProtectedHeader({ alg })
		.setIssuedAt()
		.setExpirationTime(options?.expires ?? "7 days")
		.sign(key);
}

export function isStringISODate(str: string): boolean {
	// Regular expression to match ISO 8601 date format
	const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
	return iso8601Regex.test(str);
}

export const db = drizzle(
	async (sql, params, method) => {
		try {
			const response = await fetch(env.DATABASE_PROXY, {
				method: "POST",
				headers: {
					"Content-Type": "application/jwt",
				},
				body: await signJwt({ sql, params, method }),
			});
			const rows = await response.json();

			if (rows.length > 0) {
				const keys = Object.keys(rows[0]);
				for (const key of keys) {
					if (
						typeof rows[0][key] === "string" &&
						isStringISODate(rows[0][key])
					) {
						for (const row of rows) {
							row[key] = new Date(row[key]);
						}
					}
				}
			}

			return { rows };
		} catch (e: any) {
			console.error("Error from pg proxy server: ", e.message);
			return { rows: [] };
		}
	},
	{ schema },
);
```