/// <reference types="vite/client" />
import 'reflect-metadata';
import { readable } from '@pollium/readable/app/readable';
import { listen } from '@pollium/readable/app/Application';

listen(readable({ modules: import.meta.glob('./modules/*/*/*.ts') }));
