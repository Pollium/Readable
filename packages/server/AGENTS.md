# Readable — agent guide

This file ships inside `@pollium/readable`, at `node_modules/@pollium/readable/AGENTS.md`, and is versioned
with the code it describes. An app's own guide links here and describes only its business.

Readable decides everything an API needs that is not business logic: where a file goes, how a route is
mounted, how a body is validated, how an error is answered, how the app boots and how it is tested. Follow
the layout below and a module never touches anything outside its folder.

## An app

```
package.json        "@scope/api": the scope names the app, and its event bus channel is `<scope>:events`
tsconfig.json       { "extends": "@pollium/readable/tsconfig.json" }
vite.config.ts      export default readableConfig();
src/server.ts       listen(readable());
src/modules/<module>/
    controllers/    one controller per file, default export       found and mounted on boot
    models/         one entity per file, default export           found and given to TypeORM
    events/         one event group per file, default export      found and subscribed
    queues/         one queue per file, default export            found and its worker started
    gateways/       one gateway per file, default export          found and mounted
    tools/          one tool group per file, default export       found and handed to afterMount
    services/       the business logic                            never discovered
    contracts/      types the module keeps to itself
    tests/          *.test.ts
```

Discovery imports every `.ts` file in those six folders and takes its default export. Never put a test,
a helper or a base class in them: it is imported and mounted too.

```ts
// src/server.ts
import 'reflect-metadata';
import { readable } from '@pollium/readable/app/readable';
import { listen } from '@pollium/readable/app/Application';

listen(readable());
```

`readable(options)` reads its environment and returns an `Application`; `listen` starts it and closes it on
`SIGTERM` and `SIGINT`.

| Variable | Read as |
|---|---|
| `PORT`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT` | required |
| `DATABASE_SCHEMA` | the Postgres schema, `public` when unset |
| `DATABASE_SYNCHRONIZE` | `false` turns synchronize off; it is on otherwise |
| `JWT_SECRET` | needed by anything that signs or verifies a session |
| `HOST` | where the server listens, `0.0.0.0` when unset |
| `CORS_ORIGIN` | comma separated origins; none when unset, so only the same origin is answered; `*` reflects any origin, with credentials |
| `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `STORAGE_PUBLIC_URL`, `STORAGE_REGION` | `objectStorage`, when `STORAGE_ENDPOINT` is set |
| `LOG_LEVEL`, `LOG_PRETTY` | `info` and `false` by default |

Options: `name` (instead of the package scope), `folders` (instead of `['modules']`), `timestamptz`,
`migrations`, `publicPaths` (paths any origin may call, without credentials), `plugins`, `afterDatabase`,
`afterMount`, `root` (instead of the working directory).

HTTP options, which `new Application(...)` takes too:

| Option | Does |
|---|---|
| `authenticate(token, req)` | signs a caller in: returns the `Principal`, or `null` for `401 Auth::InvalidToken`; Readable's JWT by default (Guards) |
| `signTestToken(as)` | the token `request(app, endpoint, { as })` sends, string or promise; Readable's JWT by default |
| `ids` | anything with `test(value)`, a RegExp too, deciding what an id param accepts; UUID by default |
| `mapError(error)` | turns an error that is not a `RuntimeError` into one, or `undefined` to leave it (Errors) |
| `fastify` | Fastify's own options but the logger: `keepAliveTimeout`, `requestTimeout`, `bodyLimit`, `trustProxy`, `serverFactory`, `http` |
| `exposedHeaders` | response headers a browser may read across origins, beside `x-trace-id` |
| `host` | instead of `HOST` |

Node checks `http.headersTimeout` against its own 5 minute `requestTimeout` when the server is made, so a
longer one goes with `http: { headersTimeout, requestTimeout: 0 }`. `ids`, `authenticate` and
`signTestToken` are read by free functions, so the app being built sets them for the whole process.

Every answer carries `x-trace-id`: the caller's when it is one printable token of up to 128 characters,
a new UUID otherwise. While the request runs, `traceId()` from `app/trace` returns it and every log line
carries it as `traceId`.

`readableConfig(overrides)` is the whole Vite config: body validation, typia, the `@` and `@tests`
aliases, tests under `src/**/*.test.ts` with `tests/setup.ts` when it exists, and readable itself run
through Vite so discovery can load TypeScript. Pass only what the app adds, as `readableConfig({ test:
{ restoreMocks: true } })`.

## Routes

A route's path and types live in the contracts package the web app shares:

```ts
import { get, post } from '@pollium/readable-contracts/routing';

export const noteRoutes = {
    list: get<Note[]>('/notes'),
    create: post<CreateNoteInput, Note>('/notes')
};
```

```ts
export default class NoteController extends AuthenticatedController{
    #notes = new NoteService();

    @Route(noteRoutes.create)
    @Status(201)
    create(@CurrentUser() userId: string, @Body() input: CreateNoteInput){
        return this.#notes.create(userId, input);
    }
}
```

- `@Route(endpoint)` mounts at the endpoint's own path. `@Route('/latest')` or `@Route('/latest', 'POST')`
  mounts under `/<module>`, or under `@Controller('/prefix')`. `@Route(path, { method, bodyLimit })` sets
  a body limit for that route.
- `@Route(endpoint, { body: 'stream' })` hands `@Body() body: Readable` the request stream unread, for any
  content type and before it has all arrived; no body limit applies, and an empty request is an empty stream.
- The handler's return value is the answer: a value is `200 { data }`, `undefined` or `null` is `204`,
  `new Paginated(items, page, total)` is `200 { data, meta }`, `new RawResponse(body, contentType)` and
  `new RedirectResponse(url)` are sent as they are. `@Status(code)` replaces the success status.
- `new Paginated(items, page, total, extra)` merges `extra` into `meta` (`total`, `limit` and `offset` win
  over keys of the same name); `PageMeta<Extra>` and `PageOf<T, Extra>` type it on the web.
- `new RawResponse(body, contentType, status, headers)`: `body` is a string, `Buffer`, `Uint8Array` or
  `Readable`, piped as it comes. A `Vary` in `headers` adds to the one CORS and compression set. A stream
  that fails before its first byte is answered as an error; after it, the connection is cut.
- `download(body, { filename, contentType, disposition, length, cache, headers })` from `http/download` is
  the `RawResponse` of a file: `Content-Disposition` (`attachment` unless `disposition: 'inline'`) with an
  ASCII `filename=` and an RFC 5987 `filename*=` when the name needs one, `X-Content-Type-Options:
  nosniff`, `Content-Length` when given or the body is in memory, `Cache-Control` from `cache`.
- Compression (brotli or gzip, over 1 KB) applies to JSON, text, XML, JavaScript and SVG in memory; never to
  a stream, a body that already has a `Content-Encoding`, or a `206` with `Content-Range`.
- Handlers take their inputs from parameter decorators and never read `req`:

| Decorator | Gives |
|---|---|
| `@Body()` | the body, validated and pruned against its type; a bad body is `400 Request::ValidationFailed` |
| `@IdParam('id')`, `@IdQuery('id')`, `@OptionalIdQuery('id')` | a UUID, lowercased, or what `ids` accepts, as written; anything else is `400 Request::InvalidId` |
| `@Param('name')`, `@Query('name')`, `@Query()` | one value, or the whole query |
| `@Header('If-None-Match')`, `@Ip()`, `@UserAgent()` | one request header (any case, first value), the client address after `trustProxy`, the agent |
| `@Pagination({ defaultLimit, maxLimit })` | `{ limit, offset }`, 50 and 100 by default; `?page=` (from 1) is turned into the offset, and beside `offset` it is `400 Request::InvalidPagination` |
| `@UploadedFile({ field, maxBytes, accept })` | `{ filename, buffer, field, mimetype }`, the file of `field` (the first file when none is named), when the app registers `@fastify/multipart` |
| `@FormFields()` | the form's other fields; a repeated name is a list |
| `@CurrentUser()`, `@SessionExpiresAt()` | the signed-in user's id and when the session ends |
| `@CurrentPrincipal()`, `@Token()` | the whole principal (`undefined` when an optional guard let a caller in without one) and the raw token |
| `@Owned(Service, 'id')` | `new Service().getOwned(userId, id)`, the entity the user owns |
| `@Req()`, `@Reply()` | the raw request and reply, for what nothing above covers |

`@Body()` is validated only in `src/modules/*/controllers/*.ts`, and only written as `@Body() name: Type`
with a named type: the Vite plugin rewrites exactly that shape into a typia validator.

An upload over `maxBytes` (or the plugin's `limits.fileSize`) stops being read and is `413
Request::FileTooLarge`; one outside `accept` (`'image/*'`, `'image/png'` or a list) is `400
Request::ValidationFailed` with the field's error; no file for the field is `400 Request::FileMissing`.
Every upload and form parameter of a handler shares one read of the parts, in any order.

## Guards

- `AuthenticatedController` makes every route of a controller require a bearer session (`401
  Auth::Unauthorized`, `401 Auth::InvalidToken`). `AuthenticatedRoute` is the same guard for one route.
- Every guard that signs a caller in goes through `readable({ authenticate })`. It gets the raw token and
  the request; `null` is `401 Auth::InvalidToken`, and a `RuntimeError` it throws is answered as it is. To
  close a gateway's socket when the session ends, it sets `req.sessionExpiresAt` (seconds), as the default
  does. Readable reads only `userId` of the `Principal`; an app adds its own fields:

  ```ts
  declare module '@pollium/readable/auth/sessions'{
      interface Principal{
          authType: 'user' | 'secretKey';
          teamPermissions: string[];
      }
  }
  ```
- `OptionalAuthenticatedRoute` lets a caller with no token in, without a principal, and still refuses a
  bad token. `bearerPrincipal(req)` resolves the principal of a request, or `null`, without signing it in.
- `@Middleware(a, b)` on a class or a method runs its guards in order, base class first. A guard is a
  `MiddlewareFn`, `(req, reply) => void | Promise<void>`, and refuses by throwing.
- A named guard made of others is `chain(a, b)`, which waits for each before the next. Never call a guard
  inside another without `await`: the next one reads what the first had not written yet.
- `ParamGuardRoute('orgId', assert)` signs the caller in and checks a membership for a route param.
- `SocketAuthenticatedRoute` is the guard for gateways: it reads the token from the first
  `Sec-WebSocket-Protocol` entry, then from `?token=`. `SocketOptionalAuthenticatedRoute` lets a socket
  with no token in, as `OptionalAuthenticatedRoute` does.
- `ServiceKeyRoute(header, key)` lets another service in by a shared key.
- `@RateLimit({ max, window: '1m' })` caps a route per client in Redis; the next hit is `429
  RateLimit::TooManyRequests`.

## Errors

An error table lives in the contracts, and the table throws its own errors:

```ts
import { defineErrors } from '@pollium/readable-contracts/errors';

export const NoteErrors = defineErrors({ domain: 'Note', causes: { NotFound: 404, Locked: 409 } });
```

```ts
throw NoteErrors.Locked();
return findOrThrow(Note, { id, ownerId }, NoteErrors.NotFound);
```

An error from a table is answered with its status and `{ error: 'Note::Locked' }`; `NoteErrors.Locked('x')`
answers `Note::Locked:x`. An error that is not one goes, in order, through:

1. `readable({ mapError })`, which returns a `RuntimeError` to answer with, or `undefined`;
2. the database constraints, on Postgres and SQLite alike: a unique or primary key violation is `409
   Database::UniqueViolation`, a foreign key one `409 Database::ForeignKeyViolation`, a not null one `400
   Database::NotNullViolation` (`databaseErrorOf(error)` in `app/error-answers` tells them apart);
3. a request Fastify or a plugin could not read: `400 Request::Malformed` (bad JSON), `413
   Request::BodyTooLarge` (over the body limit), `415 Request::UnsupportedMediaType` (no parser for the type).

Anything still left is logged and answered `500 { error: 'Server::Internal' }`, without its text. The web
keys its copy by `ErrorCode<typeof NoteErrors>`. Readable's own tables (`AuthErrors`, `RequestErrors`,
`RateLimitErrors`, `GatewayErrors`, `ServerErrors`, and `DatabaseErrors` and `RequestProtocolErrors`, which
the web's own copy does not require) come from the same file; to add causes to one, spread it:
`defineErrors({ domain: AuthErrors.domain, causes: { ...AuthErrors.causes, SetupClosed: 409 } })`.

## Models

```ts
@Entity()
export default class Note extends BaseModel{
    @Column()
    title!: string;

    @Fk('User', { onDelete: 'CASCADE' })
    ownerId!: string;

    @Hidden()
    @Column()
    secret!: string;
}
```

- `BaseModel` gives `id` (a UUIDv7, Postgres 18's `uuidv7()`), `createdAt` and `updatedAt`, and Active
  Record (`Note.findOneBy`, `note.save()`).
- `@Fk('User')` on `ownerId` adds the uuid column and a many-to-one `owner`.
- `@Hidden()` keeps a column out of every answer.
- `database/queries` has `findOrThrow`, `isUniqueViolation`, `nextPosition`, `advisoryLock`, `countPerDay`,
  `recentDates` and `tableRef`.
- With synchronize on, a column whose type changes is dropped and added again, and every row loses its
  value. `createdAt` and `updatedAt` are `timestamp`; an app whose tables already hold `timestamptz` passes
  `readable({ timestamptz: true })`, and never drops it.

## Events, queues, gateways

```ts
declare global{
    interface EventMap{
        'note.created': { noteId: string };
    }
}

eventBus.emit('note.created', { noteId });

@DefineEventGroup('notes')
export default class NoteEvents{
    @Event('note.created')
    created({ noteId }: { noteId: string }){ ... }
}
```

Every instance of the app hears every event, through Redis.

```ts
export default class DigestQueue extends BaseQueue<{ userId: string }>{
    readonly name = 'digest';
    protected readonly everyMs = 60_000;

    process({ userId }: { userId: string }){ ... }
}
```

`new DigestQueue().add(data)` enqueues a job. `concurrency`, `limiter`, `lockDuration` and `jobOptions`
are protected fields to override. `new QueueProducer(name)` adds jobs to a queue another process works.

```ts
@Channel('/notes/live')
@Middleware(SocketAuthenticatedRoute)
export default class NoteGateway extends BaseGateway{
    @OnMessage('watch')
    watch(@CurrentUser() userId: string, @Payload() frame: WatchFrame, @Socket() socket: WebSocket){ ... }
}
```

A message `{ type, ... }` is answered `{ type, data }` with what its handler returns, or `{ error }`.
`@OnConnect()` and `@OnDisconnect()` mark the lifecycle handlers. The websocket is registered on its own
when the app has a gateway.

## Testing

`tests/setup.ts` sets the environment, with a schema per Vitest pool (`DATABASE_SCHEMA:
test_${process.env.VITEST_POOL_ID}`), and creates that schema. Then:

```ts
import { readable } from '@pollium/readable/app/readable';
import { useApp as useSharedApp } from '@pollium/readable/testing/harness';
import { expectError, request } from '@pollium/readable/testing/request';

const useApp = () => useSharedApp({ createApp: () => readable(), schema: process.env.DATABASE_SCHEMA });

describe('NoteController', () => {
    const ctx = useApp();

    it('creates a note for its owner', async () => {
        const res = await request(ctx.app, noteRoutes.create, { as: userId, body: { title: 'a', body: '' } });

        expect(res.status).toBe(201);
    });

    it('refuses a stranger', async () => {
        expectError(await request(ctx.app, noteRoutes.list), 401, 'Auth::Unauthorized');
    });
});
```

- `useApp` builds the app once per file, truncates the schema before each test and stubs `BaseQueue.add`.
- `request(app, endpoint, { as, body, params, query, headers })` signs the request in as `as`, with the
  app's `signTestToken` when it has one. `authHeader(userId)` is the header of a Readable JWT.
- Limits are counted in Redis: spy on `rateLimitStore.incr` from `@pollium/readable/testing/rate-limit` to
  let every request in, or to answer one past the limit.
- Session cutoffs live in Redis: spy on `sessionCutoffs.cutoffOf` and `sessionCutoffs.cut` from
  `@pollium/readable/auth/sessions` to keep them in memory. Install spies before each test when a suite
  calls `vi.restoreAllMocks()`.

## Things that will otherwise burn an hour

- **`SyntaxError: Invalid or unexpected token` on a decorator at boot** means Vite is not running readable,
  so discovery handed a TypeScript file to Node. The app's `vite.config.ts` must be `readableConfig()`.
- **An endpoint's path is absolute.** Only paths a controller writes as strings get the `/<module>` prefix.
- **The Dockerfile copies the api package and the shared contracts, nothing else.** Keep `tsconfig.json`
  extending `@pollium/readable/tsconfig.json`, which comes with `node_modules`, and never a file beside
  the package.
