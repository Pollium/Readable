import { IdFormat, configureIds } from '../http/params';

export interface HttpOptions{
    ids?: IdFormat;
}

// These settings are read by free functions (parseId and the decorators built on it), so the app
// being built sets them for the whole process, back to their defaults when it leaves one out.
export const applyHttpOptions = (options: HttpOptions) => {
    configureIds(options.ids);
};
