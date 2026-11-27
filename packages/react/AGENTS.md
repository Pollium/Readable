# Readable for the web — agent guide

This file ships inside `@pollium/readable-react`, at `node_modules/@pollium/readable-react/AGENTS.md`, and
is versioned with the code it describes. A web's own guide links here and describes only its business.

The contracts package already says each route's method, path, input and output, each error table and
each gateway's frames. The web reads them from there and never writes them again: there is no `api.ts`,
no `reload()` after a mutation and no switch that turns an error code into copy.

## A web

```
package.json        react, react-dom, react-router-dom, typia, @pollium/readable-react
tsconfig.json       { "extends": "@pollium/readable-react/tsconfig.json" }
vite.config.ts      export default readableConfig({ plugins: [react()] }, { api: 'http://localhost:4100' });
src/main.tsx        mount({ name, pages: import.meta.glob(...), copy, ... });
src/modules/<module>/
    pages/guest/        pages only a signed-out visitor sees
    pages/protected/    pages only a signed-in user sees
    pages/public/       pages anyone sees
    components/  hooks/  i18n/  utils/
```

```ts
// src/main.tsx
import { mount } from '@pollium/readable-react/app/mount';
import ConsoleLayout from '@/app/layouts/ConsoleLayout';
import { appCopy } from '@/shared/i18n/errors';

mount({
    name: 'condor',
    apiUrl: import.meta.env.VITE_API_URL,
    pages: import.meta.glob('/src/modules/*/pages/**/{index,layout}.tsx'),
    layout: ConsoleLayout,
    signIn: '/entrar',
    copy: appCopy
});
```

| Option | What it does |
|---|---|
| `name` | names the session in `localStorage`: `<name>.session` |
| `apiUrl` | the api's base url; blank or unset is `<origin>/api`. A function is read on every call |
| `pages` | the page files, from `import.meta.glob`; Vite resolves them when it builds |
| `meta` | every page's meta, from `import.meta.glob(..., { import: 'meta', eager: true })`, below |
| `layout` | the frame around every protected page, with an `<Outlet />` |
| `frame` | the frame around every tier and `notFound`, inside the router: an error boundary, chrome, context menus, the title from `usePageMeta()` |
| `notFound` | the page for a path no page answers; unknown paths go to `home` without it |
| `pending` | what shows while a page or a layout loads, a skeleton; nothing when unset |
| `signIn`, `home` | where a guest is sent (`/sign-in`), and where a signed-in user is (`/`) |
| `guards` | the app's own checks of each tier, below |
| `boot` | runs before the app first draws: an async sign-in, a local stack starting; `booting` shows meanwhile, `pending` when unset |
| `copy` | the app's error copy, below |
| `sessionKey`, `legacyKeys` | the `localStorage` key of the session, and old keys a token is moved from, below |
| `timeoutMs` | how long a call may take before it fails with `Network::Timeout`; 0, the default, is no limit |
| `credentials` | fetch's `credentials` for every call (`'include'` sends cookies); unset leaves the browser's |
| `onRequest` | `(init, url) => void`, run before each call is sent: `init.headers['x-trace-id'] = id` |
| `pathDefaults` | `() => ({ teamId })`, the values of path params a call leaves out |
| `wrap` | providers around the router: `wrap: (app) => <I18nProvider i18n={i18n}>{app}</I18nProvider>` |
| `root` | the element to render into, `#root` when unset |
| `router` | `createBrowserRouter`'s options (`basename`, ...) and `RouterProvider`'s (`useTransitions`, `onError`) |

`mount` answers the router, so the app can wrap `router.navigate`, for view transitions say.

`readableConfig(overrides, { api, apiPrefix, proxy, root })` from `@pollium/readable-react/app/vite` is
the whole Vite config, on Vite 7.3 or 8: form validation, typia, the `@` alias, `react` deduped, `/api`
proxied to `api` with its websockets, and tests under `src/**/*.test.{ts,tsx}` in happy-dom with
`tests/setup.ts` when it exists. It does not import Vitest, so a web without tests does not install it.
The web adds its own plugins, as `readableConfig({ plugins: [react(), tailwindcss()] })`.

- The proxy takes `/api` off, for an api whose routes have no prefix. `apiPrefix: '/api'` is for an api
  whose routes carry it: the proxy sends `/api/...` as it is, and the web's `apiUrl` is its origin.
- `proxy: { '/socket.io': { ws: true } }` sends more paths to `api`, with Vite's proxy options.

## Pages

A page is the default export of an `index.tsx`, and its folder is its path:

| File | Path |
|---|---|
| `modules/notes/pages/protected/index.tsx` | `/` |
| `modules/notes/pages/protected/notes/[noteId]/index.tsx` | `/notes/:noteId` |
| `modules/ai/pages/protected/ai/[[conversationId]]/index.tsx` | `/ai` and `/ai/:conversationId` |
| `modules/auth/pages/guest/signIn/index.tsx` | `/sign-in` |
| `modules/notes/pages/protected/notes/layout.tsx` | the frame of `/notes` and of every page below it |

- A guest who opens a protected page is sent to `signIn?next=<where they were going>`, and back there once
  the session starts. A signed-in user on a guest page goes to `next`, or `home`.
- A page may carry meta: a title, a nav entry, what it needs. The app gives `PageMeta` its shape once, and
  each page sets it in a `meta.ts` beside its `index.tsx`:

```ts
// src/app/page-meta.ts
declare module '@pollium/readable-react/pages/meta'{
    interface PageMeta{ title?: string; nav?: 'main' | 'settings'; permissions?: Permission[] }
}

// src/modules/keys/pages/protected/dashboard/keys/meta.ts
import { PageMeta } from '@pollium/readable-react/pages/meta';

export const meta: PageMeta = { title: 'Secret keys', nav: 'settings', permissions: ['team-secret-key:read'] };

// src/main.tsx
mount({ ..., meta: import.meta.glob('/src/modules/*/pages/**/meta.ts', { import: 'meta', eager: true }) });
```

- `pageList()` from `pages/meta` lists every page as `{ tier, path, meta }`, for a nav, without loading
  any of them; `pageMeta(path)` is the meta of the page a path opens; `usePageMeta()` is the open page's,
  in the page and in every frame above it.
- `export const meta` in the `index.tsx` itself works too, and the glob is then of the `index.tsx` files,
  but Vite then puts every page in the first bundle: a module imported eagerly is never split out.
- A tier's `guards` run in order whenever one of its pages opens, and the first that names a path sends the
  user there. Readable's own check comes first: the protected tier's guards always see a session.

```ts
mount({
    ...,
    guards: {
        protected: [
            () => hasTeam() ? null : '/onboarding',
            async ({ meta }) => await canAll(meta?.permissions) ? null : '/dashboard'
        ],
        public: [() => backend() === null ? '/connect' : null]
    }
});
```

- A guard gets `{ tier, path, search, params, meta, session }`, `meta` being the opening page's, and
  answers a path, or `null` to let the user through. A guard that answers a promise shows `pending` until
  it settles; one that fails, or throws, reaches the route's error boundary.
- A path a guard names for the page the user is already on lets them stay, so `/onboarding` cannot send
  itself to `/onboarding`.
- Guards run again on every navigation and when the session changes. `recheckGuards()` from `pages/guards`
  runs them again when something else they read changes, a team deleted say. A guard may run more than
  once for one page, so it reads and does not act.
- Every page loads when it is first opened. `prefetchPage(path)` from `pages/prefetch` loads it before,
  for a link the user is about to follow.
- A layout frames every page of its tier in its folder and the folders below it, from any module. A layout
  in a folder below another sits inside it, and a page is framed by the deepest layout that holds it.
- One component at several paths is a page file at each that re-exports it:
  `export { default } from '@/modules/canvas/components/CanvasPage';`.
- Two pages at the same path of a tier stop the app at boot with `Page::DuplicatePath`; a page in an
  optional folder (`[[name]]`) is at both of its paths, so `ai/index.tsx` beside it is a duplicate.

## Queries

```ts
import { useQuery } from '@pollium/readable-react/query/useQuery';

const list = useQuery(issueRoutes.list, { path: { projectId }, query: { period, status } });
const detail = useQuery(issueRoutes.get, { path: { projectId, issueId } });
```

- A query answers `{ data, loading, error, reload, set }`. `data` is `null` until something lands.
- It waits while a path param is `undefined`, while the target is falsy (`issueId && { ... }`), while
  `enabled` is `false` and while a query in `dependsOn` has no data yet. `dependsOn` takes any
  `{ data, loading, error, reload }`, a query from an app's own hook too. A query in `dependsOn` that
  failed fails this one too.
- `select: (data) => ...` reads part of the answer. A paginated answer is `{ items, meta }`.
- A read the api takes as a `POST` with a body is `useQuery(paletteRoutes.list, { body })`; its answer is
  remembered per body.
- Every component reading the same path and query shares one request and one answer. An answer is
  fresh for 30 seconds: a page opened again in that time shows it without asking. `staleMs` changes
  it, `Infinity` for an answer that never goes stale; an invalidation still asks again.
- An answer nobody reads is kept 5 minutes; `keepMs` changes it, 0 to forget it as soon as the last
  reader leaves. Readers that ask differently keep it as long as the longest asks.
- `pollMs: 5_000` asks again 5 seconds after each answer while the query is on screen;
  `pollMs: (data) => data?.waiting ? 5_000 : false` polls only while the answer says so. A poll
  waits while the tab is hidden and asks as soon as it is shown.
- `retry: 2` asks again after a network failure, a timeout or a `408`, `429` or `5xx`, waiting
  1 s, then 2 s, 4 s, up to 30 s; `retry: (error, attempt) => boolean` decides for any error. No
  query retries by default.
- `loading` is true while the query waits or asks; `fetching` only while a request is on its way. The
  first load is `loading && data === null`.
- A reload keeps the data on screen while it asks, and keeps it with `error` set when it fails.
- `fresh: true` asks again every time the query mounts, showing the remembered answer meanwhile.
- `set(data)` replaces the answer: a frame from a gateway goes there. `reload` and `set` stay the same
  across renders, so an effect may depend on them.
- `headers: { 'X-Share-Token': token }` adds headers to a call; a query remembers its answer per headers.
- `base: env.iamServerUrl` sends a call, a query or a mutation to another api, with the same session; its
  answers are remembered apart from the main api's, and a mutation refreshes only its own api's branch.
- `prefetch(endpoint, target)` from `query/useQuery` asks before the page mounts, from a route's loader or
  a hovered link; the query that mounts later answers from it, or shares it while it is on its way. It
  answers what it read, or `null` when it could not ask or the api refused, and never throws, so one
  prefetch can follow from another: `const course = await prefetch(...)`, then its roadmap.
- `fetchQuery(endpoint, target, { staleMs, retry })` from `query/useQuery` is a query outside React:
  it answers the remembered answer while it is fresh, asks otherwise, and throws what the api refused
  or a missing path param. A query that mounts later reads what it read.
- `useQueries(endpoint, targets, options)` from `query/useQueries` answers one query per target, for a
  list that changes length. Each target waits on its own; it takes every option but `pollMs`.
- `pathDefaults` in `mount` fills a param a call leaves out, or gives as `undefined`; a query waits
  while neither has a value, and keeps each filled path's answer apart. A component renders again when
  the default changes only if it reads what the default comes from.
- `call(endpoint, { path, query, body })` from `http/call` is the same request outside React.

## Lists in pages

```ts
import { usePages } from '@pollium/readable-react/query/usePages';

const issues = usePages(issueRoutes.list, { path: { projectId }, query: { status } }, { limit: 20 });

<IssueList issues={issues.items} />
{issues.hasMore && <LoadMore onPress={issues.loadMore} busy={issues.loadingMore} />}
```

- `usePages` reads an endpoint that answers `{ items, meta }`, asking `limit` (50 by default) at a time
  with `limit` and `offset`. It answers `items` of every loaded page, `data` (the same, `null` until the
  first page lands, so `QueryState` takes it), `total`, `hasMore`, `loadMore`, `loading` (the first
  page), `loadingMore`, `fetching`, `error`, `reload` (every loaded page) and `set`.
- The next page starts where the api said the first one ends, its `meta.limit`, so a limit the api
  lowered skips nothing.
- Each page is an ordinary answer, at its own `limit` and `offset`: a mutation on its branch refreshes
  every loaded page, and the cached-data functions below reach every page.
- Components reading the same list share its pages while one of them is on screen. A list opened again
  starts from its first page, read from memory, and `loadMore` reads the next ones from memory while
  they are fresh.
- A page that fails keeps the pages before it and sets `error`; `loadMore` asks for it again.
- `set((items) => [created, ...items])` changes the loaded items: they are cut into the loaded pages
  again and `total` moves by the difference, so each page holds what the api would answer at its
  offset. What no longer fits is on the next page the api has.
- It waits and is kept apart as `useQuery` is, and takes its options but `select` and `pollMs`.

## Cached data

```ts
import { getData, removeData, setData, updateData } from '@pollium/readable-react/query/data';

setData(issueRoutes.get, { path: { projectId, issueId } }, issue);
updateData(issueRoutes.list, (issues) => issues.map((each) => each.id === issue.id ? issue : each));
removeData(issueRoutes.list);
```

- `getData(endpoint, target)` reads a remembered answer, `undefined` when there is none.
- `setData(endpoint, target, value)` writes one, or `setData(endpoint, target, (current) => next)`;
  a query reading it shows it at once, one that mounts later reads it without asking, and an answer
  still on its way is dropped.
- `updateData(endpoint, (data, target) => next)` changes every remembered answer of the endpoint, any
  path and query, the pages of a list included. Answering `undefined` or the same data leaves one as
  it is.
- `setData` and `updateData` answer a rollback that puts back what was there, unless a newer answer
  has landed since.
- `removeData(endpoint, target?)` forgets one answer, or every answer of the endpoint; `clearData()`
  forgets everything. A query on screen asks again at once, any other on its next mount. The session's
  end already forgets everything.

## Mutations

```ts
import { useMutation } from '@pollium/readable-react/query/useMutation';

const update = useMutation(issueRoutes.update, { path: { projectId, issueId } });
await update.run({ body: { status } });
```

- After it succeeds, a mutation refreshes every query on its branch of the path: `PATCH
  /projects/1/issues/9` refreshes `/projects/1/issues/9`, what is under it, and `/projects/1/issues`,
  `/projects/1` and `/projects` above it. A `DELETE` refreshes only what is above it.
- `invalidates: [projectRoutes.stats]` refreshes the queries of other endpoints as well.
  `invalidate(projectRoutes.stats)` does it outside a mutation, and `invalidate()` with nothing refreshes
  every query.
- A query on screen asks again at once; one nobody is reading asks the next time it is read. An answer
  still on its way when its query is refreshed is not taken as fresh when it lands.
- `markStale(projectRoutes.stats)` refreshes nothing now: the queries it names keep their answer on screen
  and ask again the next time a component mounts them. `markStale()` with nothing marks every query, for an
  event that may have changed anything and should not set every screen asking at once.
- `run` throws the error and keeps it in `error`; `reset()` clears it.
- `optimistic(input, { path, query })` changes what is on screen before the request leaves and answers
  how to undo it, which `setData` already does:
  `optimistic: (_, { path }) => setData(issueRoutes.list, { path }, (issues) => issues?.filter(...))`.
  When the api refuses, the rollback runs before `run` throws and the branch refreshes, so the api's
  answer replaces anything the rollback could not put back.

## Calls

- `call(endpoint, { as })` reads the answer as `'json'` (the default, unwrapped from its envelope),
  `'text'`, `'blob'`, `'arrayBuffer'`, or `'response'`, the `Response` itself to read its headers. The
  answer is typed by it. A refusal throws the same `ApiError` whatever `as` says.
- A `Blob`, `ArrayBuffer`, typed array or `URLSearchParams` body is sent as it is, and so is a string
  with `contentType: 'application/x-ipynb+json'`. Any other body is JSON, with `contentType` naming its
  media type when given. A `FormData` body never takes a `Content-Type`, so fetch writes its boundary.
- `timeoutMs` and `credentials` per call replace the ones in `mount`; `timeoutMs: 0` is no limit, as for
  a large download. The time covers the body too, except with `as: 'response'`, timed until its headers.
  A caller's own `signal` still aborts with its own reason.
- `upload(url, body, { method, headers, onProgress, signal })` from `http/upload` sends a body over XHR
  and reports `{ loaded, total }` as it goes. It puts by default. A path, or a url under `apiUrl`, is on
  the api and carries the session, `onRequest` and `credentials`, and its answer is unwrapped; any other
  url, such as a presigned one, gets only the headers given.

## States

`QueryState` from `states/QueryState` tells a query's states apart and draws none of them:

```tsx
<QueryState
    query={list}
    loading={<RowsSkeleton />}
    failed={(error, retry) => <ErrorState title={issueCopy(error)} onRetry={retry} />}
    stale={(error, retry) => <RefreshFailed onRetry={retry} />}
    empty={<EmptyState title={copy.empty} />}
>
    {(issues) => <IssueTable issues={issues} />}
</QueryState>
```

- `loading` shows only until the first answer; `reloading` shows it on every reload.
- `empty` shows for an empty list or page; `isEmpty` decides for anything else.
- A web wraps it once with its own looks and uses that wrapper everywhere.
- `useOnline()` from `states/useOnline` follows the browser going offline and back.

## Errors

```ts
import { copyFor } from '@pollium/readable-react/errors/copy';

export const issueCopy = copyFor(IssueErrors, {
    NotFound: 'This issue no longer exists',
    Locked: () => t`Someone else is changing it`
});

issueCopy(list.error);                     // a string, or null when there is no error
issueCopy.with(projectCopy)(detail.error); // the copy of both tables
```

- A table cause with no copy does not compile.
- A function is read when the error is described, so copy follows the language.
- What a table does not name falls to the app's `copy`, given to `mount`, which needs every code readable
  answers (`Auth::*`, `RateLimit::*`, `Request::*`, `Server::*`), the copy for `offline` and `unknown`,
  and may add codes several modules share. `unknown` may be `(code) => string`, to name the code it could
  not describe. `describeError(error)` reads only the app's copy.
- An error is an `ApiError` with `status`, `code` (no detail), `fields` (the field errors the api
  answered) and `isNetworkError`. A call that ran out of time is `Network::Timeout`, a network error:
  its copy is `offline` unless a table or the app's `codes` names it.

## Live data

The gateway lives in the contracts beside the routes, and the server mounts it at the same channel:

```ts
// the contracts
export const towerGateway = gateway<TowerFrames, TowerMessages>('/tower/live');

// the server
@Channel(towerGateway.channel)
```

```ts
const overview = useQuery(towerRoutes.overview, { query: { window } });
useChannel(towerGateway, { 'tower.overview': overview.set }, { join: ['tower.watch', { window }] });
```

- Frames and messages are typed by the gateway: a handler for a frame it does not send, or a message it
  does not take, does not compile.
- Every component on a channel shares one socket, closed with the last one.
- The socket sends the session's token as its subprotocol, which `SocketAuthenticatedRoute` reads, and
  reconnects with a backoff, at once when the browser is back online or the tab is shown again.
- `join` is sent on every open, so after a reconnect too, and again when it changes.
- A close with `SocketClose.SessionExpired` (4401) ends the session and stays closed. `AccessRevoked`
  (4403) reconnects: the gateway sends it when a socket loses one room, such as a conversation deleted
  while open, and a session that was really revoked ends on the next call the api refuses.
- `useChannel` answers `{ send, status, lastError, clearError }`; `lastError` is the last `{ error }`
  frame, and `onError(error, sessionId)` hears each one with the `sessionId` it names.

## Forms

```ts
import { useForm } from '@pollium/readable-react/forms/useForm';

const form = useForm(roadmapRoutes.createStep, {
    initial: { title: '', description: '' },
    path: { roadmapId },
    copy: roadmapCopy,
    onDone: (step) => onSaved(step)
});

<TextField {...form.field('title')} label={t`Title`} />
```

- `field(name)` answers `{ name, value, onChange, onBlur, isInvalid, errorMessage }`, with `onChange`
  taking the value, as HeroUI's fields do. A plain `<input>` calls `onChange(event.target.value)`.

- The Vite plugin hands every `useForm(contract.endpoint, { ... })` a typia validator of the endpoint's
  input, so the browser refuses what the server would, before sending it. `validate` given by hand
  replaces it.
- A field is checked when it is left, and on every change after that; all of them on submit.
- The form submits to its endpoint and refreshes like a mutation. The field errors the api answered land
  on their fields; `fieldOf: { 'Step::TitleTaken': 'title' }` puts a code on a field; anything else is
  `submitError`, described by `copy`. `onFail(error, values)` runs after a failed submit, for a form that
  changes what it shows when its link no longer works.
- The messages for a field are in English; `copy.fields` in `mount` replaces them.

A form with no endpoint hands its values to its own `submit`, and is validated only by the `validate` it
is given:

```ts
const probe = useForm({
    initial: { url: '' },
    validate: typia.createValidate<EndpointInput>(),
    submit: ({ url }) => probeHealth(url),
    onDone: (health) => onConnected(health)
});
```

- What `submit` throws is handled as an endpoint's error: an `ApiError`'s fields land on their fields,
  anything else is `submitError`. With no `submit`, a valid submit only calls `onDone(undefined, values)`.
- `validateField(name)` and `validateFields(['fullName', 'password'])` check those fields now, show their
  errors, leave the others' alone and answer whether they passed: one step of a form at a time.
  `validateFields()` checks them all.
- `handleSubmit(event, { submit, fields })` submits once through another action and checks only `fields`,
  for a step with its own request or a second button. It does not refresh what the endpoint would; the
  form's `onDone` and `onFail` still run.
- `values` and `watch(name)` are the values now; `watch()` is all of them.
- `reset(values)` starts the form again from `values`, and a later `reset()` goes back to them.
- `setFieldError(name, message)` puts the app's own message on a field, until the field next changes;
  `null` takes it off.

## Session

`session.start(token)` signs in, `session.end()` signs out, and `useSession()` renders again on each. The
token is kept in `localStorage`, under `<name>.session` or the `sessionKey` given to `mount`, and sent as
a bearer token on every call and socket. `legacyKeys: ['authToken']` moves a token kept under an old key
on the first read, once, and empties the old keys; a token under the session key wins. The session ends by
itself when the api answers `401 Auth::Unauthorized` or `Auth::InvalidToken` to the token it was sent,
when a gateway closes for it and when another tab signs out. A call still on its way with an old token
never ends a session started after it. Every query forgets what it loaded, and the ones still on screen
once the guards have taken the protected pages away ask again without the token.

## Testing

```ts
import { configure } from '@pollium/readable-react/app/config';

beforeEach(() => configure({ name: 'condor', apiUrl: 'http://api.test' }));
```

Stub `fetch` with `vi.stubGlobal` and answer `{ data }` as the api does; `WebSocket` the same way for a
gateway, and `XMLHttpRequest` for an upload. A test renders a page or a hook with `@testing-library/react`.

## Things that will otherwise burn an hour

- **A query that never loads has a path param with the wrong name.** A query waits while any `:param`
  of its path has no value, and a misspelt name never gets one.
- **`useQuery(endpoint, undefined)` is `useQuery(endpoint)`.** For an endpoint with no params, wait with
  `enabled`, not with a falsy target.
- **A form is validated only when written `useForm(contract.endpoint, { ... })`**, with the endpoint
  named and the options inline. Anything else, a form with no endpoint too, gets no validator unless it
  is given `validate`, and the server still refuses.
- **`typia` must be a dependency of the web.** The plugin writes `import typia from 'typia'` into the
  web's own files.
- **The handlers of `useChannel` are read once, when it mounts.** A handler added later is never called;
  its body may change on every render.
- **A path default fills `undefined` too.** `{ path: { teamId: maybeTeam } }` takes the default team while
  `maybeTeam` is unset; wait with `enabled` when that is not what you mean.
- **Nothing retries, polls or times out by itself.** A query retries and polls only when it says so,
  and a call times out only with `timeoutMs` in `mount` or on the call; an app that wants a retry on
  every query wraps `useQuery` once.
- **On Node 25 a test that reads `localStorage` gets Node's.** `readableConfig` starts the test workers
  with `--no-experimental-webstorage`; a web that writes its own Vite config needs the same.
