import { configure } from '../lib/app/config';
import { cache } from '../lib/query/cache';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
    localStorage.clear();
    cache.clear();
    configure({ name: 'notes', apiUrl: 'http://api.test/' });
});

afterEach(() => cleanup());
