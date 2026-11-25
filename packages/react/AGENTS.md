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
| `apiUrl` | the api's base url; blank or unset is `<origin>/api` |
| `pages` | the page files, from `import.meta.glob`; Vite resolves them when it builds |
| `layout` | the frame around every protected page, with an `<Outlet />` |
| `notFound` | the page for a path no page answers; unknown paths go to `home` without it |
| `signIn`, `home` | where a guest is sent (`/sign-in`), and where a signed-in user is (`/`) |
| `copy` | the app's error copy, below |
| `wrap` | providers around the router: `wrap: (app) => <I18nProvider i18n={i18n}>{app}</I18nProvider>` |
| `root` | the element to render into, `#root` when unset |

`readableConfig(overrides, { api, root })` from `@pollium/readable-react/app/vite` is the whole Vite
config: form validation, typia, the `@` alias, `react` deduped, `/api` proxied to `api` with its
websockets, and tests under `src/**/*.test.{ts,tsx}` in happy-dom with `tests/setup.ts` when it exists.
The web adds its own plugins, as `readableConfig({ plugins: [react(), tailwindcss()] })`.

## Pages

A page is the default export of an `index.tsx`, and its folder is its path:

| File | Path |
|---|---|
| `modules/notes/pages/protected/index.tsx` | `/` |
| `modules/notes/pages/protected/notes/[noteId]/index.tsx` | `/notes/:noteId` |
| `modules/auth/pages/guest/signIn/index.tsx` | `/sign-in` |
| `modules/notes/pages/protected/notes/layout.tsx` | the frame of `/notes` and of the pages one folder below it |

- A guest who opens a protected page is sent to `signIn?next=<where they were going>`, and back there once
  the session starts. A signed-in user on a guest page goes to `next`, or `home`.
- Every page loads when it is first opened. `prefetchPage(path)` from `pages/prefetch` loads it before,
  for a link the user is about to follow.
- Two pages at the same path of a tier stop the app at boot with `Page::DuplicatePath`.

## Queries

```ts
import { useQuery } from '@pollium/readable-react/query/useQuery';

const list = useQuery(issueRoutes.list, { path: { projectId }, query: { period, status } });
const detail = useQuery(issueRoutes.get, { path: { projectId, issueId } });
```

- A query answers `{ data, loading, error, reload, set }`. `data` is `null` until something lands.
- It waits while a path param is `undefined`, while the target is falsy (`issueId && { ... }`), while
  `enabled` is `false` and while a query in `dependsOn` has no data yet. A query in `dependsOn` that
  failed fails this one too.
- `select: (data) => ...` reads part of the answer. A paginated answer is `{ items, meta }`.
- Every component reading the same path and query shares one request and one answer. An answer is
  fresh for 30 seconds: a page opened again in that time shows it without asking.
- A reload keeps the data on screen while it asks, and keeps it with `error` set when it fails.
- `fresh: true` asks again every time the query mounts, showing the remembered answer meanwhile.
- `set(data)` replaces the answer: a frame from a gateway goes there. `reload` and `set` stay the same
  across renders, so an effect may depend on them.
- `headers: { 'X-Share-Token': token }` adds headers to a call; a query remembers its answer per headers.
- `prefetch(endpoint, target)` from `query/useQuery` asks before the page mounts, from a route's loader or
  a hovered link; the query that mounts later answers from it, or shares it while it is on its way.
- `call(endpoint, { path, query, body })` from `http/call` is the same request outside React.

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
  `invalidate(projectRoutes.stats)` does it outside a mutation.
- A query on screen asks again at once; one nobody is reading asks the next time it is read.
- `run` throws the error and keeps it in `error`; `reset()` clears it.

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
  answered) and `isNetworkError`.

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
- A close with `SocketClose.SessionExpired` (4401) or `AccessRevoked` (4403) ends the session and stays
  closed.
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

## Session

`session.start(token)` signs in, `session.end()` signs out, and `useSession()` renders again on each. The
token is kept in `localStorage` and sent as a bearer token on every call and socket. The session ends by
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
gateway. A test renders a page or a hook with `@testing-library/react`.

## Things that will otherwise burn an hour

- **A query that never loads has a path param with the wrong name.** A query waits while any `:param`
  of its path has no value, and a misspelt name never gets one.
- **`useQuery(endpoint, undefined)` is `useQuery(endpoint)`.** For an endpoint with no params, wait with
  `enabled`, not with a falsy target.
- **A form is validated only when written `useForm(contract.endpoint, { ... })`**, with the endpoint
  named and the options inline. Anything else gets no validator, and the server still refuses.
- **`typia` must be a dependency of the web.** The plugin writes `import typia from 'typia'` into the
  web's own files.
- **The handlers of `useChannel` are read once, when it mounts.** A handler added later is never called;
  its body may change on every render.
- **On Node 25 a test that reads `localStorage` gets Node's.** `readableConfig` starts the test workers
  with `--no-experimental-webstorage`; a web that writes its own Vite config needs the same.
