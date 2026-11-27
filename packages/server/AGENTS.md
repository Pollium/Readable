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
| `CORS_ORIGIN` | comma separated origins; none when unset, so only the same origin is answered |
| `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `STORAGE_PUBLIC_URL`, `STORAGE_REGION` | `objectStorage`, when `STORAGE_ENDPOINT` is set |
| `LOG_LEVEL`, `LOG_PRETTY` | `info` and `false` by default |

Options: `name` (instead of the package scope), `folders` (instead of `['modules']`), `timestamptz`,
`migrations`, `publicPaths` (paths any origin may call, without credentials), `plugins`, `afterDatabase`,
`afterMount`, `root` (instead of the working directory).

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
- The handler's return value is the answer: a value is `200 { data }`, `undefined` or `null` is `204`,
  `new Paginated(items, page, total)` is `200 { data, meta }`, `new RawResponse(body, contentType)` and
  `new RedirectResponse(url)` are sent as they are. `@Status(code)` replaces the success status.
- Handlers take their inputs from parameter decorators and never read `req`:

| Decorator | Gives |
|---|---|
| `@Body()` | the body, validated and pruned against its type; a bad body is `400 Request::ValidationFailed` |
| `@IdParam('id')`, `@IdQuery('id')`, `@OptionalIdQuery('id')` | a UUID; anything else is `400 Request::InvalidId` |
| `@Param('name')`, `@Query('name')`, `@Query()` | one value, or the whole query |
| `@Pagination({ defaultLimit, maxLimit })` | `{ limit, offset }`, 50 and 100 by default |
| `@UploadedFile()` | the multipart file, when the app registers `@fastify/multipart` |
| `@CurrentUser()`, `@SessionExpiresAt()` | the signed-in user's id and when the session ends |
| `@Owned(Service, 'id')` | `new Service().getOwned(userId, id)`, the entity the user owns |
| `@Req()`, `@Reply()` | the raw request and reply, for what nothing above covers |

`@Body()` is validated only in `src/modules/*/controllers/*.ts`, and only written as `@Body() name: Type`
with a named type: the Vite plugin rewrites exactly that shape into a typia validator.

## Guards

- `AuthenticatedController` makes every route of a controller require a bearer session (`401
  Auth::Unauthorized`, `401 Auth::InvalidToken`).
- `@Middleware(a, b)` on a class or a method runs its guards in order, base class first. A guard is a
  `MiddlewareFn`, `(req, reply) => void | Promise<void>`, and refuses by throwing.
- A named guard made of others is `chain(a, b)`, which waits for each before the next. Never call a guard
  inside another without `await`: the next one reads what the first had not written yet.
- `ParamGuardRoute('orgId', assert)` signs the caller in and checks a membership for a route param.
- `SocketAuthenticatedRoute` is the guard for gateways: it reads the token from the subprotocol or `?token=`.
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
answers `Note::Locked:x`. Anything else is logged and answered `500 { error: 'Server::Internal' }`, without
its text. The web keys its copy by `ErrorCode<typeof NoteErrors>`. Readable's own tables (`AuthErrors`,
`RequestErrors`, `RateLimitErrors`, `GatewayErrors`, `ServerErrors`) come from the same file; to add causes
to one, spread it: `defineErrors({ domain: AuthErrors.domain, causes: { ...AuthErrors.causes, SetupClosed:
409 } })`.

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
- `request(app, endpoint, { as, body, params, query, headers })` signs the request in as `as`.
- Limits are counted in Redis: spy on `rateLimitStore.incr` from `@pollium/readable/testing/rate-limit` to
  let every request in, or to answer one past the limit.
- Session cutoffs live in Redis: spy on `sessionCutoffs.cutoffOf` and `sessionCutoffs.cut` from
  `@pollium/readable/auth/sessions` to keep them in memory. Install spies before each test when a suite
  calls `vi.restoreAllMocks()`.

## Things that will otherwise burn an hour

- **`SyntaxError: Invalid or unexpected token` on a decorator at boot** means Vite is not running readable,
  so discovery handed a TypeScript file to Node. The app's `vite.config.ts` must be `readableConfig()`.
- **An endpoint's path is absolute.** Only paths a controller writes as strings get the `/<module>` prefix.
- **A gateway method named `register` or `toRoom` replaces the base class's own**, and the channel is
  never mounted or never relays. Name handlers after their message.
- **The Dockerfile copies the api package and the shared contracts, nothing else.** Keep `tsconfig.json`
  extending `@pollium/readable/tsconfig.json`, which comes with `node_modules`, and never a file beside
  the package.
