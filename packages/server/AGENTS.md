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

Discovery imports every `.ts` and `.js` file in those six folders and takes its default export; a `.d.ts`,
a `.map` or a `.test.*` file is skipped. Never put a helper or a base class in them: it is imported and
mounted too.

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
| `PORT`, `DATABASE_URL` | required |
| `DATABASE_URL=sqlite:<path>`, `sqlite::memory:` | SQLite through better-sqlite3, which the app installs; any other URL is Postgres |
| `REDIS_HOST`, `REDIS_PORT` | Redis, when `REDIS_HOST` is set; the port is `6379` when unset |
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

- `database`: more TypeORM options, as `{ poolSize, applicationName, logging, invalidWhereValuesBehavior:
  { null: 'ignore', undefined: 'ignore' } }`, on either dialect. Readable's own keys win (`type`, `url`,
  `database`, `entities`, `migrations`, `synchronize`, `schema`), and a `prepareDatabase` runs after
  Readable's own on SQLite. `createDataSource(config, entities, migrations, options)` takes the same.
- `transport`: what carries events and `broadcast` (see Events), instead of the one the environment picks.
- `sessionCutoffs`: a `SessionCutoffStore` (`cutoffOf(userId)`, `cut(userId, at?)`) instead of Redis or
  memory.
- `modules`: the record `import.meta.glob` returns, instead of reading the folders from disk (see Builds).

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
aliases, tests under `src/**/*.test.ts` with `tests/setup.ts` when it exists, readable itself run
through Vite so discovery can load TypeScript, and `vite build` (see Builds). Pass only what the app adds,
as `readableConfig({ test: { restoreMocks: true } })`.

### Builds

`vite build` makes `dist/server.js` from `src/server.ts`, for Node 22: the app's dependencies stay imports
Node resolves from `node_modules`, and readable goes into the bundle. A bundle has no module folders to
read, so its server hands discovery a glob:

```ts
// src/server.ts
/// <reference types="vite/client" />
import 'reflect-metadata';
import { readable } from '@pollium/readable/app/readable';
import { listen } from '@pollium/readable/app/Application';

listen(readable({ modules: import.meta.glob('./modules/*/*/*.ts') }));
```

The glob may be lazy or eager (never with `import:`), and `folders` still says which folders count; keys
are matched on their end, so `./modules/...`, `../modules/...` and `/src/modules/...` all work. The same
files load in the same order as from disk. `discoverModules(record, folders)` does it for an app that
builds its own `Application`. Run the build with `node dist/server.js` from the app's folder.

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
- `@RateLimit({ max, window: '1m' })` caps a route per client, counted in Redis, or in the process
  without Redis; the next hit is `429 RateLimit::TooManyRequests`.

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
- `@JsonColumn(options)` is `jsonb` on Postgres and `simple-json` on SQLite, read from `DATABASE_URL` when
  the model's file is imported.
- `database/queries` has `findOrThrow`, `isUniqueViolation`, `nextPosition`, `advisoryLock`, `countPerDay`,
  `recentDates` and `tableRef`, on both dialects.
- With synchronize on, a column whose type changes is dropped and added again, and every row loses its
  value. `createdAt` and `updatedAt` are `timestamp`; an app whose tables already hold `timestamptz` passes
  `readable({ timestamptz: true })`, and never drops it.

On SQLite:

- Each connection gets a `uuidv7()` SQL function, so the id's default works there too.
- The root manager's transactions (`dataSource.transaction`, `Model.getRepository().manager.transaction`)
  run one at a time on the one connection; a transaction opened inside one goes through the manager it was
  handed and is a savepoint. Opening one through the root manager from inside another waits forever.
- `advisoryLock` does nothing, since transactions already run one at a time; `isUniqueViolation`
  recognises SQLite's unique and primary key errors; `recentDates` and `countPerDay` count days in UTC.
- `DATABASE_SCHEMA` and `timestamptz` are ignored, and dates are `datetime`.
- Insert entities made with `create()` or `new`, which carry their id. `insert({ ... })` of a plain object
  without an id fails there: TypeORM reads the new row back by its id on SQLite, and it has none.
- A table whose name starts with `sqlite_` is refused, so no model is called `Sqlite...`.

## Events and queues

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

Every instance of the app hears every event, and every `broadcast.subscribe(channel, handler)` hears every
`broadcast.publish(channel, payload)`, through one transport:

| The app has | Transport |
|---|---|
| `REDIS_HOST` | `RedisTransport`: Redis pub/sub |
| no Redis, a Postgres `DATABASE_URL` | `PostgresTransport`: LISTEN/NOTIFY on one channel, `readable_transport` |
| neither | `MemoryTransport`: this process only |

`readable({ transport })` or `useTransport(transport)` from `events/transports` replaces it. A transport is
`{ publish(channel, message), subscribe(channel, onMessage), close() }` over strings and delivers to every
subscriber, the publisher's own process included. On Postgres a message too big for a notification (over
`inlineBytes`, 7000) goes to the `readable_transport_spool` table in the app's schema and only its id is
sent; every instance reads the row, and rows older than `retainMs` (five minutes) are swept every minute.
A dropped LISTEN connection is opened again. Under Vitest the event bus stays in the process unless the
test chose a transport; broadcast always uses it.

```ts
export default class DigestQueue extends BaseQueue<{ userId: string }>{
    readonly name = 'digest';
    protected readonly everyMs = 60_000;

    process({ userId }: { userId: string }){ ... }
}
```

`new DigestQueue().add(data)` enqueues a job. `concurrency`, `limiter`, `lockDuration` and `jobOptions`
are protected fields to override. `new QueueProducer(name)` adds jobs to a queue another process works.
Queues live in Redis: an app that has a queue and no `REDIS_HOST` stops at boot with
`Config::MissingEnv:REDIS_HOST` (`build({ queues: false })`, as the test harness builds, does not).

## Gateways

```ts
@Channel(noteGateway.channel)
@Middleware(SocketAuthenticatedRoute)
export default class NoteGateway extends BaseGateway{
    @OnMessage('note.watch')
    watch(@CurrentUser() userId: string, @Payload() frame: WatchFrame, @Connection() connection: Connection){ ... }
}
```

The frames, both ways, are JSON text:

| Frame | Is |
|---|---|
| `{ type, ...fields }` from a client | a message; answered `{ type, data }` with what its handler returns, nothing when that is `undefined` or `null`, or `{ error, sessionId? }` |
| `{ type, id, ...fields }` from a client | a request; always answered `{ type, re: id, data }` (`data: null` for nothing) or `{ type, re: id, error, sessionId? }` |
| `{ type, data }` from the server | a frame for the client's handlers of `type` |
| `{ type, id, data }` from the server | a request from `connection.request()`; the client answers `{ type, re: id, data }` or `{ type, re: id, error }` |

A message's own fields are never named `type`, `id` or `re`. A binary WebSocket frame carries any of these
with bytes: `[u32 big-endian header length][UTF-8 JSON header][raw bytes]`, the header being the frame.
`encodeFrame(header, bytes?)` and `decodeFrame(raw)` from `@pollium/readable-contracts/gateway` read and
write it; a binary frame that holds only JSON text is read as text.

| Decorator | Gives |
|---|---|
| `@Payload()` | the whole frame, or a binary frame's header |
| `@Bytes()` | a binary frame's bytes, `undefined` for text |
| `@Connection()` | the connection: `id`, `principal`, `data`, `req`, `socket`, `send`, `request`, `close`, `bufferedAmount`, `drained()` |
| `@Socket()` | the raw `ws` socket |
| `@CurrentUser()` | the principal's id, as on a route |

- A handler answers with bytes by returning `binary(data, bytes)`. `connection.send(type, data, bytes?)`
  sends one frame and says whether the socket was open.
- `connection.request<T>(type, data, { timeoutMs = 30_000, bytes })` asks the client and resolves with
  its answer, a `Binary` (`{ data, bytes }`) when the answer has bytes. It rejects with `Gateway::Timeout`,
  with `Gateway::Closed` when the socket closes first, and with the client's code (status 502) when it
  refuses. `timeoutMs: 0` waits for as long as the socket lives.
- `connection.data` is the connection's own object, shared by every gateway on the channel. Type it as
  `Connection<{ teamId?: string }>`.
- `this.connections` takes a socket, a connection or a connection id: `join(target, room, access?)`,
  `leave`, `leaveAll`, `isIn(target, room)`, `roomsOf(target)`, `members(room)` (the connections, with
  their principal and data), `connection(id)`, `sendTo(target, frame, bytes?)` (`false` when there is no
  such open connection), `sendToRoom`, `sendToRooms`, `sendToRoomExcept(room, target, frame, bytes?)`,
  `broadcast` and `has(room)`. These reach this instance's sockets only.
- `this.toRoom(room, frame, { except, bytes })` sends to the room here and, through `broadcast`, on every
  other instance of the app. An instance hears other instances' room sends from the first join on its
  channel.
- `@OnConnect()` and `@OnDisconnect()` mark the lifecycle handlers. A message waits until every connect
  handler has finished, so a connect handler may load what the others read from `connection.data`; an
  answer to a server request never waits.
- `@OnShutdown()` runs once when the app stops; then every socket is closed with `1001` and given two
  seconds to go. `Application.stop()` does both; an app that drives Fastify itself calls
  `closeGateways(app)` before `app.close()`.

Several gateways may name the same channel. They share its sockets and rooms, each takes its own message
types, every connect and disconnect handler of each runs, and the guards of all of them run once each at
the upgrade. Two of them taking one message type, or giving one option two values, stop the boot with
`Gateway::DuplicateMessageType` or `Gateway::ConflictingOptions`.

`@Channel(path, options)`:

| Option | Does |
|---|---|
| `maxPayload` | the largest frame a client may send, in bytes; larger closes with `1009`. The websocket's own, 1 MB, otherwise |
| `compression` | `true` (above 1 KB), `{ threshold }` or `false`: per-message deflate for this channel |
| `pingIntervalMs` | pings every socket; one that has not answered the last ping is ended |
| `refusal: 'close'` | a guard's refusal accepts the upgrade and closes at once with `4000 + status` (`4401`, `4403`, ...) and the error code as the reason. Without it the upgrade is answered with the HTTP status, as before |

The websocket is registered on its own when the app has a gateway.

`GatewayClient` from `@pollium/readable/gateway/client` is the client for Node 22 and later (a daemon, a
worker, another service), on Node's own WebSocket:

```ts
const client = new GatewayClient('wss://api.example.com/clusters/live', { token, headers: { 'x-cluster': id } });
client.join('cluster.register', { clusterId });
client.answer('cluster.command', async (command) => run(command));
const status = await client.request('cluster.status', { clusterId }, { timeoutMs: 5_000 });
```

- `token` goes first among `protocols`, where `SocketAuthenticatedRoute` reads it; `headers` go with the
  upgrade.
- It reconnects with the browser's backoff, sends its joins on every open before anything else, and
  queues what it sends while it connects, 256 frames by default (`queueLimit`); `send` answers `false` and
  `request` rejects `Gateway::QueueFull` past that.
- `send(type, fields, { bytes, queue })`, `request(type, fields, { bytes, timeoutMs })`,
  `on(type, (data, bytes) => ...)`, `answer(type, handler)`, `onStatus`, `onError`, `reconnect()`, `close()`.
- A close with `4401`, or `4403` with an error code, stays closed and hands the code to `onError`;
  anything else reconnects.

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
  On SQLite (`DATABASE_URL: 'sqlite::memory:'`, no `schema`) it deletes every row of every table instead.
- `request(app, endpoint, { as, body, params, query, headers })` signs the request in as `as`, with the
  app's `signTestToken` when it has one. `authHeader(userId)` is the header of a Readable JWT.
- Limits are counted in Redis when the app has it: spy on `rateLimitStore.incr` from
  `@pollium/readable/testing/rate-limit` to let every request in, or to answer one past the limit. Without
  Redis they are counted in memory, and `memoryRateLimitStore.incr` is the one to spy on.
- Session cutoffs live in Redis when the app has it and in memory (`MemorySessionCutoffStore`) otherwise.
  Spy on `sessionCutoffs.cutoffOf` and `sessionCutoffs.cut` from `@pollium/readable/auth/sessions` to keep
  a Redis app's in memory. Install spies before each test when a suite calls `vi.restoreAllMocks()`.

## Things that will otherwise burn an hour

- **`SyntaxError: Invalid or unexpected token` on a decorator at boot** means Vite is not running readable,
  so discovery handed a TypeScript file to Node. The app's `vite.config.ts` must be `readableConfig()`.
- **`[MISSING_EXPORT]` or an undefined import in a build** is an interface imported without `import type`.
  readableConfig shims it for `vite build` as Vitest does; a config of the app's own must set
  `build.rollupOptions.shimMissingExports`, or the import must say `import type`.
- **An endpoint's path is absolute.** Only paths a controller writes as strings get the `/<module>` prefix.
- **A gateway method named `register` or `toRoom` replaces the base class's own**, and the channel is
  never mounted or never relays. Name handlers after their message.
- **The Dockerfile copies the api package and the shared contracts, nothing else.** Keep `tsconfig.json`
  extending `@pollium/readable/tsconfig.json`, which comes with `node_modules`, and never a file beside
  the package.
