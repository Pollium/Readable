export interface PageQuery{
    limit?: number;
    offset?: number;
    page?: number;
}

type NoExtra = Record<never, never>;

export type PageMeta<Extra extends object = NoExtra> = Extra & {
    total: number;
    limit: number;
    offset: number;
};

export interface PageOf<T, Extra extends object = NoExtra>{
    items: T[];
    meta: PageMeta<Extra>;
}

export interface ApiResponse<T, Extra extends object = NoExtra>{
    data: T;
    meta?: PageMeta<Extra>;
}

export interface ApiError{
    error: string;
    errors?: Record<string, string>;
}
