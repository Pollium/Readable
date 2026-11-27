import { QueryState, QueryStateProps } from '../lib/states/QueryState';
import { useOnline } from '../lib/states/useOnline';
import { Query } from '../lib/query/useQuery';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type Notes = string[];

const query = (state: Partial<Query<Notes>>): Query<Notes> => ({
    data: null,
    loading: false,
    fetching: false,
    error: undefined,
    reload: vi.fn(),
    set: vi.fn(),
    ...state
});

const shown = (props: Partial<QueryStateProps<Notes>> & Pick<QueryStateProps<Notes>, 'query'>) => render(
    <QueryState
        loading={<p>loading</p>}
        failed={(error, retry) => <button onClick={retry}>failed {error.message}</button>}
        stale={(error) => <p>stale {error.message}</p>}
        empty={<p>no notes</p>}
        {...props}
    >
        {(notes) => <p>{notes.join(', ')}</p>}
    </QueryState>
);

describe('QueryState', () => {
    it('shows what the app draws while the first answer is coming', () => {
        shown({ query: query({ loading: true }) });

        expect(screen.getByText('loading')).toBeTruthy();
    });

    it('keeps the data on screen while it reloads, unless asked not to', () => {
        const { rerender } = shown({ query: query({ loading: true, data: ['a'] }) });
        expect(screen.getByText('a')).toBeTruthy();

        rerender(<QueryState query={query({ loading: true, data: ['a'] })} loading={<p>loading</p>} reloading>{(notes) => notes.join()}</QueryState>);
        expect(screen.getByText('loading')).toBeTruthy();
    });

    it('offers a retry when nothing loaded', () => {
        const failing = query({ error: new Error('Server::Internal') });
        shown({ query: failing });

        fireEvent.click(screen.getByText('failed Server::Internal'));

        expect(failing.reload).toHaveBeenCalledOnce();
    });

    it('shows the empty state for an empty list or page', () => {
        const { rerender } = shown({ query: query({ data: [] }) });
        expect(screen.getByText('no notes')).toBeTruthy();

        rerender(
            <QueryState query={{ data: { items: [], meta: { total: 0, limit: 10, offset: 0 } }, loading: false, error: undefined, reload: vi.fn() }} empty={<p>no page</p>}>
                {() => 'items'}
            </QueryState>
        );
        expect(screen.getByText('no page')).toBeTruthy();
    });

    it('draws the data and says a refresh failed under it', () => {
        shown({ query: query({ data: ['a', 'b'], error: new Error('Network::Unreachable') }) });

        expect(screen.getByText('a, b')).toBeTruthy();
        expect(screen.getByText('stale Network::Unreachable')).toBeTruthy();
    });
});

describe('useOnline', () => {
    it('follows the browser going offline and back', () => {
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        const { result } = renderHook(() => useOnline());

        online.mockReturnValue(false);
        act(() => {
            window.dispatchEvent(new Event('offline'));
        });

        expect(result.current).toBe(false);
    });
});
