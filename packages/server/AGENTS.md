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
| `DATABASE_URL=sqlite:<path>`, `sqlite::memory:` | SQLite through better-sqlite3, which the app installs; any other URL is Postgres |
| `DATABASE_SCHEMA` | the Postgres schema, `public` when unset |
| `DATABASE_SYNCHRONIZE` | `false` turns synchronize off; it is on otherwise |
| `JWT_SECRET` | needed by anything that signs or verifies a session |
| `CORS_ORIGIN` | comma separated origins; none when unset, so only the same origin is answered |
| `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `STORAGE_PUBLIC_URL`, `STORAGE_REGION` | `objectStorage`, when `STORAGE_ENDPOINT` is set |
| `LOG_LEVEL`, `LOG_PRETTY` | `info` and `false` by default |

Options: `name` (instead of the package scope), `folders` (instead of `['modules']`), `timestamptz`,
`migrations`, `publicPaths` (paths any origin may call, without credentials), `plugins`, `afterDatabase`,
`afterMount`, `root` (instead of the working directory).

- `database`: more TypeORM options, as `{ poolSize, applicationName, logging, invalidWhereValuesBehavior:
  { null: 'ignore', undefined: 'ignore' } }`, on either dialect. Readable's own keys win (`type`, `url`,
  `database`, `entities`, `migrations`, `synchronize`, `schema`), and a `prepareDatabase` runs after
  Readable's own on SQLite. `createDataSource(config, entities, migrations, options)` takes the same.

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
  On SQLite (`DATABASE_URL: 'sqlite::memory:'`, no `schema`) it deletes every row of every table instead.
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
- **The Dockerfile copies the api package and the shared contracts, nothing else.** Keep `tsconfig.json`
  extending `@pollium/readable/tsconfig.json`, which comes with `node_modules`, and never a file beside
  the package.
