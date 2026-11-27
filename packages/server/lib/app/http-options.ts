import { IdFormat, configureIds } from '../http/params';
import { Authenticate, SignTestToken, configureAuthentication } from '../auth/authentication';

export interface HttpOptions{
    ids?: IdFormat;
    authenticate?: Authenticate;
    signTestToken?: SignTestToken;
}

// These settings are read by free functions (parseId, the guards and the test request helper), so
// the app being built sets them for the whole process, back to their defaults when it leaves one out.
export const applyHttpOptions = (options: HttpOptions) => {
    configureIds(options.ids);
    configureAuthentication(options);
};
