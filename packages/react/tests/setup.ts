import { configure } from '../lib/app/config';
import { beforeEach } from 'vitest';

beforeEach(() => {
    localStorage.clear();
    configure({ name: 'notes', apiUrl: 'http://api.test/' });
});
