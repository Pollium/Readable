# Migrating an app from its readable copy

Each app (Learn, Sentinel, Condor, Modafinil, Foundry) carries its own `packages/shared/readable`.
Moving onto this package means five changes, then deleting the copy.

## 1. Name the app

`configure()` takes the app's `name`, and the event bus listens on `${name}:events`. Pass the name
the copy hardcoded, or instances still on the copy and instances on this package stop hearing each
other's events during the deploy:

| App | `name` |
|---|---|
| Learn | `pollium` |
| Sentinel | `sentinel` |
| Condor | `condor` |
| Modafinil | `modafinil` |
| Foundry | `foundry` |

## 2. Drop `auth/fastify.d.ts` from the tsconfig

`req.principal` and `req.sessionExpiresAt` now come with `@readable/auth/sessions`. Remove
`lib/auth/fastify.d.ts` from the api's `include`; keep `lib/testing/rate-limit-store.d.ts`.

## 3. Rewrite the imports

Modules that kept their path are not listed. Imports that now share a module merge into one
statement, and the classes in the last column turned from default into named exports.

| Before | Now | Import change |
|---|---|---|
| `@readable/auth/AuthenticatedController` | `@readable/auth/guards` | `import AuthenticatedController` → `import { AuthenticatedController }` |
| `@readable/auth/AuthenticatedRoute` | `@readable/auth/guards` |  |
| `@readable/auth/CurrentUser` | `@readable/auth/params` |  |
| `@readable/auth/JWTService` | `@readable/auth/sessions` | `import JWTService` → `import { JWTService }` |
| `@readable/auth/Owned` | `@readable/auth/params` |  |
| `@readable/auth/ParamGuardRoute` | `@readable/auth/guards` |  |
| `@readable/auth/PasswordService` | `@readable/auth/credentials` | `import PasswordService` → `import { PasswordService }` |
| `@readable/auth/SessionExpiresAt` | `@readable/auth/params` |  |
| `@readable/auth/SocketAuthenticatedRoute` | `@readable/auth/guards` |  |
| `@readable/auth/bearerPrincipal` | `@readable/auth/guards` |  |
| `@readable/auth/errors` | `@readable/app/errors` |  |
| `@readable/auth/pkce` | `@readable/auth/credentials` |  |
| `@readable/auth/principalId` | `@readable/auth/params` |  |
| `@readable/auth/types` | `@readable/auth/sessions` |  |
| `@readable/auth/verifiedSession` | `@readable/auth/sessions` |  |
| `@readable/config` | `@readable/app/config` |  |
| `@readable/contracts/events` | `@readable/events/EventBus` |  |
| `@readable/contracts/gateway` | `@readable/gateway/ConnectionRegistry` |  |
| `@readable/contracts/logging` | `@readable/app/logger` |  |
| `@readable/contracts/middleware` | `@readable/http/middleware` |  |
| `@readable/contracts/params` | `@readable/http/params` |  |
| `@readable/contracts/rate-limit` | `@readable/http/middleware` |  |
| `@readable/contracts/routing` | `@readable/http/Controller` |  |
| `@readable/contracts/session` | `@readable/auth/sessions` |  |
| `@readable/contracts/storage` | `@readable/storage/ObjectStorage` |  |
| `@readable/contracts/tools` | `@readable/tools/ToolGroup` |  |
| `@readable/contracts/upload` | `@readable/http/params` |  |
| `@readable/controllers/BaseController` | `@readable/http/Controller` |  |
| `@readable/controllers/responses/Paginated` | `@readable/http/responses` | `import Paginated` → `import { Paginated }` |
| `@readable/controllers/responses/Raw` | `@readable/http/responses` | `import RawResponse` → `import { RawResponse }` |
| `@readable/controllers/responses/Redirect` | `@readable/http/responses` | `import RedirectResponse` → `import { RedirectResponse }` |
| `@readable/decorators/controllers/Controller` | `@readable/http/Controller` |  |
| `@readable/decorators/controllers/Params` | `@readable/http/params` |  |
| `@readable/decorators/controllers/RequestParams` | `@readable/http/params` |  |
| `@readable/decorators/controllers/Route` | `@readable/http/Controller` |  |
| `@readable/decorators/controllers/Status` | `@readable/http/Controller` |  |
| `@readable/decorators/gateway/Channel` | `@readable/gateway/Gateway` |  |
| `@readable/decorators/gateway/Gateway` | `@readable/gateway/Gateway` |  |
| `@readable/decorators/gateway/Params` | `@readable/gateway/Gateway` |  |
| `@readable/decorators/middleware/Middleware` | `@readable/http/middleware` |  |
| `@readable/decorators/middleware/RateLimit` | `@readable/http/middleware` |  |
| `@readable/decorators/queues/EventGroup` | `@readable/events/EventBus` |  |
| `@readable/decorators/tools/ToolGroup` | `@readable/tools/ToolGroup` |  |
| `@readable/errors/ConfigError` | `@readable/app/errors` |  |
| `@readable/errors/CryptoError` | `@readable/app/errors` |  |
| `@readable/errors/Event` | `@readable/app/errors` |  |
| `@readable/errors/Gateway` | `@readable/app/errors` |  |
| `@readable/errors/RateLimit` | `@readable/app/errors` |  |
| `@readable/errors/Request` | `@readable/app/errors` |  |
| `@readable/errors/Route` | `@readable/app/errors` |  |
| `@readable/errors/RuntimeError` | `@readable/app/errors` | `import RuntimeError` → `import { RuntimeError }` |
| `@readable/errors/SchemaError` | `@readable/app/errors` |  |
| `@readable/errors/Validation` | `@readable/app/errors` | `import ValidationError` → `import { ValidationError }` |
| `@readable/events/register-event-group` | `@readable/events/EventBus` |  |
| `@readable/gateway/BaseGateway` | `@readable/gateway/Gateway` |  |
| `@readable/gateway/create-context` | `@readable/gateway/Gateway` |  |
| `@readable/gateway/websocket-options` | `@readable/gateway/Gateway` |  |
| `@readable/http/Application` | `@readable/app/Application` |  |
| `@readable/http/ServiceClient` | `@readable/http/call` | `import ServiceClient` → `import { ServiceClient }` |
| `@readable/http/ServiceKeyRoute` | `@readable/http/call` |  |
| `@readable/http/compression` | `@readable/app/compression` |  |
| `@readable/http/data-source` | `@readable/database/data-source` |  |
| `@readable/http/discover` | `@readable/app/discovery` |  |
| `@readable/http/listen` | `@readable/app/Application` |  |
| `@readable/models/BaseModel` | `@readable/database/models` | `import BaseModel` → `import { BaseModel }` |
| `@readable/models/Fk` | `@readable/database/models` |  |
| `@readable/models/Hidden` | `@readable/database/models` |  |
| `@readable/redis/RedisClient` | `@readable/app/redis` |  |
| `@readable/service-config` | `@readable/app/config` |  |
| `@readable/services/AbortScope` | `@readable/app/abort` |  |
| `@readable/services/ModuleDiscovery` | `@readable/app/discovery` | `import ModuleDiscovery` → `import { ModuleDiscovery }` |
| `@readable/services/RedisSessionCutoffStore` | `@readable/auth/sessions` | `import RedisSessionCutoffStore` → `import { RedisSessionCutoffStore }` |
| `@readable/services/SecretCipher` | `@readable/auth/secrets` | `import SecretCipher` → `import { SecretCipher }` |
| `@readable/testing/postgres` | `@readable/testing/harness` |  |
| `@readable/utils/ClassMetadata` | `@readable/app/metadata` | `import ClassMetadata` → `import { ClassMetadata }` |
| `@readable/utils/Logger` | `@readable/app/logger` |  |
| `@readable/utils/controllers/parse-body` | `@readable/http/params` |  |
| `@readable/utils/controllers/parse-id` | `@readable/http/params` |  |
| `@readable/utils/controllers/parse-ordinal` | `@readable/http/params` |  |
| `@readable/utils/controllers/parse-pagination` | `@readable/http/params` |  |
| `@readable/utils/env` | `@readable/app/config` |  |
| `@readable/utils/errors/define-errors` | `@readable/app/errors` |  |
| `@readable/utils/models/advisory-lock` | `@readable/database/queries` |  |
| `@readable/utils/models/day-series` | `@readable/database/queries` |  |
| `@readable/utils/models/find-or-throw` | `@readable/database/queries` |  |
| `@readable/utils/models/is-unique-violation` | `@readable/database/queries` |  |
| `@readable/utils/models/next-position` | `@readable/database/queries` |  |
| `@readable/utils/models/table-ref` | `@readable/database/queries` |  |
| `@readable/utils/uuidv7` | `@readable/database/models` |  |
| `@readable/vite/auto-validate-body` | `@readable/http/auto-validate-body` |  |

## 4. Read the shared contracts from `@pollium/readable-contracts`

`Endpoint`, `HttpMethod`, the `get`/`post`/`patch`/`put`/`del` builders, `ApiError`, `PageMeta`,
`ErrorTable` and the `Gateway`, `Request`, `RateLimit`, `Auth` and `Server` error tables live in
`@pollium/readable-contracts/{routing,http,errors}`. Re-export them from the app's own contracts so
its web code keeps its imports.

## 5. Expect these behaviour changes

- A failure that is not a `RuntimeError` answers `500 { error: 'Server::Internal' }` instead of its message.
- `createDataSource` is optional; without it the app opens no database and skips `afterDatabase`.
- `ParamGuardRoute` waits for the session check, so it works without `AuthenticatedController` too.
- `AuthErrors` holds only `Unauthorized` and `InvalidToken`; identity causes stay in the app.
- `ProgressScope` is not here; Learn keeps it in its own code.
- `REAUTHORIZE_MS`, `SESSION_EXPIRED`, `ACCESS_REVOKED` and `MAX_FRAME_BYTES` are no longer exported;
  a test that waits for a reauthorization advances `30_000` ms and expects close codes `4401` and `4403`.
