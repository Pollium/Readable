import { apps } from './support/apps';
import recorded from './support/app-routes.json' with { type: 'json' };
import { resolutionsOf, routesOfApp, shapeOf } from './support/route-tree';
import { describe, expect, it } from 'vitest';

// app-routes.json is what these apps got from Readable before layouts framed their whole folder: the
// routes, and which frames and page draw each of their paths. None of their layouts has a page more than
// one folder below it, so both rules give them the same app.
describe.each(Object.entries(apps))('the pages of %s', (name, app) => {
    const before = recorded[name as keyof typeof recorded];

    it('make the same routes as before', () => {
        expect(shapeOf(routesOfApp(app))).toEqual(before.routes);
    });

    it('draw every path in the same frames as before', async () => {
        expect(await resolutionsOf(app)).toEqual(before.resolutions);
    });
});
